"""
All methods take/return plain Python dicts and lists so they can be serialised
to JSON by FastAPI directly.
"""

import asyncio
import math
from datetime import datetime, timedelta, time as time_t
from typing import Any, Dict, List, Optional

import numpy as np
import openmeteo_requests
import pandas as pd
import requests_cache
from haversine import inverse_haversine
from retry_requests import retry


# ── Wind category constants ─────────────────────────────────────────────────
# Single source of truth for wind quality category names used throughout
# display() and consumed by the frontend.  Prevents mismatches like the
# "gusty" vs "good_gusty" bug.

class Cat:
    GOOD         = "good"
    CROSS        = "cross"
    GOOD_GUSTY   = "good_gusty"
    CROSS_GUSTY  = "cross_gusty"
    NO           = "no"

    FLYABLE = {GOOD, CROSS, GOOD_GUSTY, CROSS_GUSTY}

    GUSTY_THRESHOLD = 20  # km/h — gusts must exceed wind speed by this much

    @classmethod
    def _empty_quality_dict(cls) -> Dict[str, int]:
        return {cls.GOOD: 0, cls.CROSS: 0, cls.GOOD_GUSTY: 0, cls.CROSS_GUSTY: 0}

    @classmethod
    def quality_index(cls, cat: str) -> Optional[int]:
        return {
            cls.GOOD:        0,
            cls.CROSS:       1,
            cls.GOOD_GUSTY:  2,
            cls.CROSS_GUSTY: 3,
        }.get(cat)


# ── Wind & heading range algorithm ───────────────────────────────────────────
# Parameters are loaded from a mode-specific ranges JSON (e.g. ranges_para.json)
# and passed into point_ranges() at startup.
# Formulas are stored as human-readable strings in the JSON and parsed at
# evaluation time so the user can swap e.g. linear → quadratic by just editing
# the formula string.

_FORMULA_FUNCS = {
    "ln":    math.log,
    "log":   math.log,
    "sqrt":  math.sqrt,
    "exp":   math.exp,
    "abs":   abs,
}


def _eval_formula(formula: str, variables: Dict[str, float]) -> float:
    """Safely evaluate a formula string with the given variables.

    Supports: +, -, *, /, **, parentheses, numeric literals,
    and functions: ln(), log(), sqrt(), exp(), abs().
    """
    namespace = {**_FORMULA_FUNCS, **variables}
    # compile() + eval() with a restricted namespace — no builtins
    return float(eval(compile(formula, "<formula>", "eval"), {"__builtins__": {}}, namespace))


def point_ranges(point: Dict, ranges_cfg: Dict) -> Dict:
    """
    Compute wind_range and head_range for a soar point from its slope data.

    wind_range — {wing_key: [min_kmh, max_kmh]} calibrated for default_weight.
    head_range — {"good": [lo, hi], "cross": [lo, hi]} relative to heading.

    The optional point["head_range"] = [lower_cross, upper_cross] can override
    the calculated cross-wind bounds for whichever values are not None.
    The good-wind range is always good_fraction of the cross-wind range.
    """
    steepness = point["slope"]["steepness"]
    height    = float(point["slope"]["height"])

    factor = _eval_formula(
        ranges_cfg["speed_height_scaling"]["formula"],
        {"height": height},
    )

    base_min   = ranges_cfg["min_speed_by_steepness"][steepness]
    wind_range = {
        key: [round(base_min * factor, 1), round(max_spd * factor, 1)]
        for key, max_spd in ranges_cfg["max_speed_by_wing"].items()
    }

    hcfg      = ranges_cfg["heading_range"]
    calc_half = _eval_formula(hcfg["formula"], {"height": height})
    calc_half += hcfg.get("steepness_offset", {}).get(steepness, 0)
    good_frac = hcfg["good_fraction"]
    override  = point.get("head_range") or [None, None]
    cross_lo  = float(override[0]) if override[0] is not None else -calc_half
    cross_hi  = float(override[1]) if override[1] is not None else  calc_half

    head_range = {
        "cross": [cross_lo,                cross_hi],
        "good":  [cross_lo * good_frac,    cross_hi * good_frac],
    }

    return {"wind_range": wind_range, "head_range": head_range}


def _sanitise(obj):
    """Replace NaN/±inf (Python float or numpy scalar) with None so json.dumps never raises."""
    if isinstance(obj, list):
        return [_sanitise(v) for v in obj]
    if isinstance(obj, dict):
        return {k: _sanitise(v) for k, v in obj.items()}
    try:
        if not math.isfinite(obj):
            return None
    except (TypeError, ValueError):
        pass
    return obj


# ── Hourly classification helpers ────────────────────────────────────────────

def _classify_wind_direction(wind_dir: float, heading: float, head_range: Dict) -> str:
    """Classify a wind direction relative to a heading into a base Cat category.

    Returns one of Cat.GOOD, Cat.CROSS, or Cat.NO.
    Also returns the pizza slice index via a separate function.
    """
    rel = wind_dir - heading
    if rel > 180:
        rel -= 360
    elif rel < -180:
        rel += 360

    cross_lo, cross_hi = head_range["cross"]
    good_lo, good_hi   = head_range["good"]

    if cross_lo < rel < good_lo:
        return Cat.CROSS
    elif good_lo <= rel <= good_hi:
        return Cat.GOOD
    elif good_hi < rel < cross_hi:
        return Cat.CROSS
    else:
        return Cat.NO


def _pizza_slice(cat: str, head_range: Dict, rel_angle: float) -> Optional[int]:
    """Return wind_pizza index (0=left-cross, 1=good, 2=right-cross) or None."""
    if cat == Cat.NO:
        return None
    good_mid = sum(head_range["good"]) / 2
    return 1 if cat == Cat.GOOD else (0 if rel_angle < good_mid else 2)


def _apply_gustiness(cat: str, wind_speed: float, wind_gusts: float) -> str:
    """Append _gusty suffix when gusts exceed wind speed by > threshold."""
    if cat != Cat.NO and wind_gusts - wind_speed > Cat.GUSTY_THRESHOLD:
        return cat + "_gusty"
    return cat


def _accumulate_quality(
    cat: str,
    wind_quality: List[int],
    wind_pizza: List[int],
    head_range: Dict,
    rel_angle: float,
    flyable_wings: List[Dict],
    wing_quality_counts: Dict[str, Dict[str, int]],
    individual_wing_hours: Dict[str, int],
):
    """Update all quality accumulators for a single hour."""
    idx = Cat.quality_index(cat)
    if idx is not None:
        wind_quality[idx] += 1

    sl = _pizza_slice(cat, head_range, rel_angle)
    if sl is not None:
        wind_pizza[sl] += 1

    if cat in Cat.FLYABLE and flyable_wings:
        ws_key = ",".join(sorted(f"{w['key']}:{w['size']}" for w in flyable_wings))
        if ws_key not in wing_quality_counts:
            wing_quality_counts[ws_key] = Cat._empty_quality_dict()
        if cat in wing_quality_counts[ws_key]:
            wing_quality_counts[ws_key][cat] += 1
        for w in flyable_wings:
            wk = f"{w['key']}:{w['size']}"
            individual_wing_hours[wk] = individual_wing_hours.get(wk, 0) + 1


# ── Segment trackers ─────────────────────────────────────────────────────────

class _GanttTracker:
    """Tracks consecutive flyable segments with the same category+wing set."""

    def __init__(self):
        self.entries = []
        self._seg_key = None
        self._seg_start = None
        self._seg_wings = None

    def update(self, cat: str, flyable_wings: List[Dict], t_shifted: str):
        if cat in Cat.FLYABLE and flyable_wings:
            wings_sorted = sorted(flyable_wings, key=lambda w: w["size"])
            ws_key = ",".join(f"{w['key']}:{w['size']}" for w in wings_sorted)
            cur_key = f"{cat}|{ws_key}"
            cur_wings = [{"key": w["key"], "size": w["size"]} for w in wings_sorted]
        else:
            cur_key = Cat.NO
            cur_wings = []

        if cur_key != self._seg_key:
            if self._seg_key is not None and self._seg_key != Cat.NO:
                self.entries.append({
                    "type":  self._seg_key.split("|", 1)[0],
                    "start": self._seg_start,
                    "end":   t_shifted,
                    "wings": self._seg_wings or [],
                })
            self._seg_key   = cur_key
            self._seg_start = t_shifted
            self._seg_wings = cur_wings

    def flush(self, end_exc: str):
        if self._seg_key is not None and self._seg_key != Cat.NO:
            self.entries.append({
                "type":  self._seg_key.split("|", 1)[0],
                "start": self._seg_start,
                "end":   end_exc,
                "wings": self._seg_wings or [],
            })


class _WeatherTracker:
    """Tracks consecutive fog or rain segments."""

    def __init__(self):
        self.entries = []
        self._prev = None
        self._start = None

    def update(self, cat: str, t_shifted: str):
        if cat != self._prev:
            if self._prev is not None:
                self.entries.append({"type": self._prev, "start": self._start, "end": t_shifted})
            self._prev  = cat
            self._start = t_shifted

    def flush(self, end_exc: str):
        if self._prev is not None:
            self.entries.append({"type": self._prev, "start": self._start, "end": end_exc})


class _TimeoutCachedSession(requests_cache.CachedSession):
    """CachedSession that injects a default per-request timeout.

    Without this, a stalled Open-Meteo connection would block the fetch
    thread forever — which in turn traps the `updating_forecast` flag in
    main.py because the surrounding `try/finally` never reaches `finally`.
    """
    DEFAULT_TIMEOUT = 30  # seconds per HTTP call

    def request(self, method, url, **kwargs):
        kwargs.setdefault("timeout", self.DEFAULT_TIMEOUT)
        return super().request(method, url, **kwargs)


class ForecastService:
    BASE_URL = "https://api.open-meteo.com/v1/forecast"

    def __init__(self, soar_points: List[Dict], timezone: str = "Europe/Berlin"):
        self.points = soar_points
        self.timezone = timezone
        cache_session = _TimeoutCachedSession(".cache", expire_after=3600)
        retry_session = retry(cache_session, retries=5, backoff_factor=0.2)
        self._client = openmeteo_requests.Client(session=retry_session)

    # ── Fetch ────────────────────────────────────────────────────────────────
    async def fetch_raw(self, model: str = "knmi_seamless", model_resolution: float = 2.0) -> List[Dict]:
        """Fetch Open-Meteo data for all soar points. Returns raw list."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._fetch_blocking, model, model_resolution)

    def _fetch_blocking(self, model: str, model_resolution: float) -> List[Dict]:
        # Offshore wind is sampled 1 grid cell upwind of each location.
        offshore_coords = [
            inverse_haversine((p["lat"], p["lon"]), model_resolution * 2.0, math.radians(p["heading"]))
            for p in self.points
        ]
        params = {
            "latitude":  [p["lat"] for p in self.points],
            "longitude": [p["lon"] for p in self.points],
            "daily":     ["sunrise", "sunset"],
            "hourly":    ["temperature_2m", "visibility", "precipitation"],
            "models":    model,
            "timezone":  self.timezone,
            "past_days": 1,
            "forecast_days": 7,
        }
        offshore_params = {
            "latitude":  [c[0] for c in offshore_coords],
            "longitude": [c[1] for c in offshore_coords],
            "hourly":    ["wind_speed_10m", "wind_direction_10m", "wind_gusts_10m"],
            "models":    model,
            "timezone":  self.timezone,
            "past_days": 1,
            "forecast_days": 7,
        }

        responses          = self._client.weather_api(self.BASE_URL, params=params)
        offshore_responses = self._client.weather_api(self.BASE_URL, params=offshore_params)

        result = []
        for idx, (resp, off_resp) in enumerate(zip(responses, offshore_responses)):
            hourly          = resp.Hourly()
            offshore_hourly = off_resp.Hourly()

            dates = pd.date_range(
                start=pd.to_datetime(hourly.Time(), unit="s", utc=True),
                end=pd.to_datetime(hourly.TimeEnd(), unit="s", utc=True),
                freq=pd.Timedelta(seconds=hourly.Interval()),
                inclusive="left",
            )

            daily       = resp.Daily()
            daily_dates = pd.date_range(
                start=pd.to_datetime(daily.Time(), unit="s", utc=True),
                end=pd.to_datetime(daily.TimeEnd(), unit="s", utc=True),
                freq=pd.Timedelta(seconds=daily.Interval()),
                inclusive="left",
            )
            sunrises = pd.to_datetime(daily.Variables(0).ValuesInt64AsNumpy(), unit="s", utc=True)
            sunsets  = pd.to_datetime(daily.Variables(1).ValuesInt64AsNumpy(), unit="s", utc=True)

            result.append({
                "id": idx,
                "actual_lat":         resp.Latitude(),
                "actual_lon":         resp.Longitude(),
                "offshore_actual_lat": off_resp.Latitude(),
                "offshore_actual_lon": off_resp.Longitude(),
                "hourly": {
                    "date":           [str(d) for d in dates],
                    "temperature":    hourly.Variables(0).ValuesAsNumpy().tolist(),
                    "visibility":     hourly.Variables(1).ValuesAsNumpy().tolist(),
                    "precipitation":  hourly.Variables(2).ValuesAsNumpy().tolist(),
                    "wind_speed":     offshore_hourly.Variables(0).ValuesAsNumpy().tolist(),
                    "wind_direction": offshore_hourly.Variables(1).ValuesAsNumpy().tolist(),
                    "wind_gusts":     offshore_hourly.Variables(2).ValuesAsNumpy().tolist(),
                },
                "daily": {
                    "date":    [str(d) for d in daily_dates],
                    "sunrise": [str(s) for s in sunrises],
                    "sunset":  [str(s) for s in sunsets],
                },
            })
        return _sanitise(result)

    # ── Process ──────────────────────────────────────────────────────────────
    def process(
        self,
        raw: List[Dict],
    ) -> List[List[Dict]]:
        """
        Process raw forecast into day×point structure.

        Args:
            raw:       Raw list returned by fetch_raw().
            selected_wings: List of {"key": str, "size": int} dicts chosen by
                            the user.

        Returns:
            list[day] of list[point] of hourly dicts.
        """
        sample_dates = [pd.Timestamp(d).date() for d in raw[0]["daily"]["date"]]
        dates = sorted(set(sample_dates))

        forecast = []
        for date in dates:
            daily_info = []
            for pt_raw in raw:
                for i, d in enumerate(pt_raw["daily"]["date"]):
                    if pd.Timestamp(d).date() == date:
                        daily_info.append({
                            "sunrise": pd.Timestamp(pt_raw["daily"]["sunrise"][i]),
                            "sunset":  pd.Timestamp(pt_raw["daily"]["sunset"][i]),
                        })
                        break

            day_data = []
            for pt_idx, pt_raw in enumerate(raw):
                sr = daily_info[pt_idx]["sunrise"]
                ss = daily_info[pt_idx]["sunset"]

                # Include all hours for the calendar date (no sunrise/sunset filtering)
                day_start = sr.normalize()                        # midnight local
                day_end   = day_start + pd.Timedelta(days=1)
                times = [pd.Timestamp(t) for t in pt_raw["hourly"]["date"]]
                mask  = [(day_start <= t < day_end) for t in times]

                def _filter(key):
                    return [pt_raw["hourly"][key][i] for i, ok in enumerate(mask) if ok]

                day_data.append({
                    "sunrise":        sr.isoformat(),
                    "sunset":         ss.isoformat(),
                    "actual_lat":              pt_raw.get("actual_lat"),
                    "actual_lon":              pt_raw.get("actual_lon"),
                    "offshore_actual_lat":     pt_raw.get("offshore_actual_lat"),
                    "offshore_actual_lon":     pt_raw.get("offshore_actual_lon"),
                    "time":           [t.isoformat() for t, ok in zip(times, mask) if ok],
                    "temperature":    _filter("temperature"),
                    "visibility":     _filter("visibility"),
                    "precipitation":  _filter("precipitation"),
                    "wind_speed":     _filter("wind_speed"),
                    "wind_direction": _filter("wind_direction"),
                    "wind_gusts":     _filter("wind_gusts"),
                })
            forecast.append(day_data)
        return forecast
    
    @staticmethod
    def effective_wind_range(
        point: Dict,
        selected_wings: List[Dict],
        wings_config: Dict,
        ranges_cfg: Dict,
        weight: float = 70.0,
    ) -> List[Dict]:
        """
        For each selected wing, scale wind range bounds by
        sqrt((default_size / size) * (weight / default_weight)).
        Returns list of: [{"key": wing_key, "size": size, "range": [min_wind, max_wind]}].
        """
        wind_ranges    = []
        base_ranges    = point_ranges(point, ranges_cfg)["wind_range"]
        default_weight = ranges_cfg["default_weight"]

        for wing in selected_wings:
            key            = wing["key"]
            if key not in base_ranges:
                continue  # skip unknown wing keys
            size           = float(wing["size"])
            wr             = base_ranges[key]
            default_size   = float(wings_config[key]["default_size"])
            size_ratio     = default_size / size
            weight_ratio   = weight / default_weight
            min_wind       = wr[0] * np.sqrt(size_ratio * weight_ratio)
            max_wind       = wr[1] * np.sqrt(size_ratio * weight_ratio)
            wind_ranges.append({"key": key, "size": size, "range": [min_wind, max_wind]})

        return wind_ranges

    # ── Display ──────────────────────────────────────────────────────────────
    def display(
        self,
        forecast: List[List[Dict]],
        t_start: time_t = time_t(0, 0),
        t_end:   time_t = time_t(23, 59),
        selected_wings: List[Dict] = [{"key": "scraper_16", "size": 16}],
        wings_config:   Dict       = None,
        ranges_cfg:     Dict       = None,
        weight:         float      = 70.0,
        wind_min: Optional[float]  = None,
        wind_max: Optional[float]  = None,
        ignore_precip_vis: bool    = False,
    ) -> List[List[Dict]]:
        """
        Compute wind_pizza, quality hours, gantt for each day×point.

        Args:
            forecast:       Processed forecast (output of process()).
            t_start:        Start of the flyable-hours time window.
            t_end:          End of the flyable-hours time window.
            selected_wings: List of {"key": str, "size": int} dicts chosen by the user.
            wings_config:   Full wings catalogue from wings.json.
            weight:         Total pilot weight in flight (kg).
            wind_min:       Custom minimum wind speed (km/h). When both wind_min and
                            wind_max are supplied, wing/weight calculations are skipped
                            and this flat range is applied to every location.
            wind_max:       Custom maximum wind speed (km/h) applied to gusts.
        """

        custom_mode = wind_min is not None and wind_max is not None

        eff_ranges  = (
            None if custom_mode
            else [
                self.effective_wind_range(pt, selected_wings, wings_config, ranges_cfg, weight)
                for pt in self.points
            ]
        )
        head_ranges = [point_ranges(pt, ranges_cfg)["head_range"] for pt in self.points]

        disp = []
        for day_idx, day in enumerate(forecast):
            day_disp = []
            for pt_idx, pf in enumerate(day):
                point = self.points[pt_idx]
                hd    = head_ranges[pt_idx]

                wind_quality         = [0, 0, 0, 0]
                wind_pizza           = [0, 0, 0]
                wing_quality_counts  = {}
                individual_wing_hours = {}
                gantt_tracker        = _GanttTracker()
                fog_tracker          = _WeatherTracker()
                rain_tracker         = _WeatherTracker()
                last_time            = None

                for i, iso_time in enumerate(pf["time"]):
                    t = pd.Timestamp(iso_time)
                    t_local = t.tz_convert("Europe/Amsterdam") if t.tzinfo else t

                    win_start = t_local.replace(hour=t_start.hour, minute=t_start.minute,
                                                second=0, microsecond=0)
                    if t_end.hour == 0 and t_end.minute == 0:
                        win_end = t_local.normalize() + pd.Timedelta(days=1)
                    else:
                        win_end = t_local.replace(hour=t_end.hour, minute=t_end.minute,
                                                  second=0, microsecond=0)
                    in_window = win_start <= t_local <= win_end

                    if custom_mode:
                        flyable_wings = (
                            [{"key": "custom", "size": 0}]
                            if (float(pf["wind_speed"][i] or 0) >= wind_min
                                and float(pf["wind_gusts"][i] or 0) <= wind_max)
                            else []
                        )
                    else:
                        wind_ranges = eff_ranges[pt_idx]
                        flyable_wings = [
                            {"key": wing["key"], "size": int(wing["size"]) if float(wing["size"]).is_integer() else wing["size"]}
                            for wing in wind_ranges
                            if (float(pf["wind_speed"][i] or 0) > wing["range"][0]
                                and float(pf["wind_gusts"][i] or 0) < wing["range"][1])
                        ]
                    wind_flyable = len(flyable_wings) > 0

                    flyable = (
                        in_window
                        and (ignore_precip_vis or float(pf["precipitation"][i] or 0) <= 0.1)
                        and (ignore_precip_vis or float(pf["visibility"][i]    or 9999) > 299)
                        and wind_flyable
                    )

                    t_shifted = (t - timedelta(days=day_idx)).isoformat()

                    is_fog  = in_window and float(pf["visibility"][i]    or 9999) < 300
                    is_rain = in_window and float(pf["precipitation"][i] or 0)    > 0.1
                    fog_tracker.update("fog" if is_fog else "no", t_shifted)
                    rain_tracker.update("rain" if is_rain else "no", t_shifted)

                    if flyable:
                        wind_dir = float(pf["wind_direction"][i] or 0)
                        rel = wind_dir - point["heading"]
                        if rel > 180: rel -= 360
                        elif rel < -180: rel += 360
                        base_cat = _classify_wind_direction(wind_dir, point["heading"], hd)
                    else:
                        base_cat = Cat.NO
                        rel = 0.0

                    cat = _apply_gustiness(base_cat, float(pf["wind_speed"][i] or 0),
                                           float(pf["wind_gusts"][i] or 0))

                    _accumulate_quality(cat, wind_quality, wind_pizza, hd, rel,
                                        flyable_wings, wing_quality_counts,
                                        individual_wing_hours)

                    gantt_tracker.update(cat, flyable_wings, t_shifted)
                    last_time = t_shifted

                if last_time:
                    end_exc = (pd.Timestamp(last_time) + timedelta(hours=1)).isoformat()
                    gantt_tracker.flush(end_exc)
                    fog_tracker.flush(end_exc)
                    rain_tracker.flush(end_exc)

                best_wing = None
                if individual_wing_hours:
                    best_wk = max(individual_wing_hours, key=individual_wing_hours.get)
                    bk, bs = best_wk.rsplit(':', 1)
                    best_wing = {"key": bk, "size": int(float(bs)) if float(bs).is_integer() else float(bs)}

                day_disp.append({
                    "wind_pizza":    wind_pizza,
                    "good_hours":    wind_quality[0],
                    "cross_hours":   wind_quality[1],
                    "gusty_hours":   wind_quality[2],
                    "cross_gusty_hours":   wind_quality[3],
                    "wing_set_hours": wing_quality_counts,
                    "gantt":         gantt_tracker.entries,
                    "fog_gantt":     [g for g in fog_tracker.entries  if g["type"] == "fog"],
                    "rain_gantt":    [g for g in rain_tracker.entries if g["type"] == "rain"],
                    "has_fog":       any(g["type"] == "fog"  for g in fog_tracker.entries),
                    "has_rain":      any(g["type"] == "rain" for g in rain_tracker.entries),
                    "wind_ranges":   (
                        [{"key": "custom", "range": [wind_min, wind_max]}]
                        if custom_mode else eff_ranges[pt_idx]
                    ),
                    "best_wing":     best_wing,
                })
            disp.append(day_disp)
        return disp