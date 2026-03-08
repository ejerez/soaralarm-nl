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
from retry_requests import retry


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


class ForecastService:
    BASE_URL = "https://api.open-meteo.com/v1/forecast"

    def __init__(self, soar_points: List[Dict]):
        self.points = soar_points
        cache_session = requests_cache.CachedSession(".cache", expire_after=3600)
        retry_session = retry(cache_session, retries=5, backoff_factor=0.2)
        self._client = openmeteo_requests.Client(session=retry_session)

    # ── Fetch ────────────────────────────────────────────────────────────────
    async def fetch_raw(self, model: str = "knmi_seamless") -> List[Dict]:
        """Fetch Open-Meteo data for all soar points. Returns raw list."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._fetch_blocking, model)

    def _fetch_blocking(self, model: str) -> List[Dict]:
        params = {
            "latitude":  [p["lat"] for p in self.points],
            "longitude": [p["lon"] for p in self.points],
            "daily":     ["sunrise", "sunset"],
            "hourly":    ["temperature_2m", "visibility", "precipitation"],
            "models":    model,
            "timezone":  "Europe/Berlin",
            "past_days": 1,
            "forecast_days": 7,
        }
        offshore_params = {
            "latitude":  [p["offshore_lat"] for p in self.points],
            "longitude": [p["offshore_lon"] for p in self.points],
            "hourly":    ["wind_speed_10m", "wind_direction_10m", "wind_gusts_10m"],
            "models":    model,
            "timezone":  "Europe/Berlin",
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
                window_start = sr - timedelta(hours=1)
                window_end   = ss + timedelta(hours=1)

                times = [pd.Timestamp(t) for t in pt_raw["hourly"]["date"]]
                mask  = [(window_start <= t <= window_end) for t in times]

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
    
    DEFAULT_WEIGHT = 75.0   # kg — baseline pilot weight the wind ranges are calibrated for

    @staticmethod
    def effective_wind_range(
        point: Dict,
        selected_wings: List[Dict],
        wings_config: Dict,
        weight: float = 75.0,
    ) -> List[Dict]:
        """
        For each selected wing, scale wind range bounds by
        sqrt((default_size / size) * (weight / default_weight)).
        Returns list of: [{"key": wing_key, "size": size, "range": [min_wind, max_wind]}].
        """
        wind_ranges = []
    
        for wing in selected_wings:
            key            = wing["key"]
            size           = float(wing["size"])
            wr             = point["wind_range"][key]
            default_size   = float(wings_config[key]["default_size"])
            size_ratio     = default_size / size
            weight_ratio   = weight / ForecastService.DEFAULT_WEIGHT
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
        weight:         float      = 75.0,
        wind_min: Optional[float]  = None,
        wind_max: Optional[float]  = None,
    ) -> List[List[Dict]]:
        """
        Compute wind_pizza, good_hours, cross_hours, gantt for each day×point.

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

        # Pre-compute effective wind range per point (constant across all days).
        # Skipped in custom mode — the flat wind_min/wind_max is used instead.
        eff_ranges = (
            None if custom_mode
            else [
                self.effective_wind_range(pt, selected_wings, wings_config, weight)
                for pt in self.points
            ]
        )

        disp = []
        for day_idx, day in enumerate(forecast):
            day_disp = []
            for pt_idx, pf in enumerate(day):
                point      = self.points[pt_idx]
                wind_pizza = [0, 0, 0]  # left-cross, good, right-cross
                wind_quality = [0, 0, 0, 0]
                gantt      = []
                prev       = None
                start      = None
                last_time  = None

                for i, iso_time in enumerate(pf["time"]):
                    t = pd.Timestamp(iso_time)
                    t_local = t.tz_convert("Europe/Amsterdam") if t.tzinfo else t

                    in_window = (
                        t_local.replace(hour=t_start.hour, minute=t_start.minute,
                                        second=0, microsecond=0)
                        <= t_local <=
                        t_local.replace(hour=t_end.hour, minute=t_end.minute,
                                        second=0, microsecond=0)
                    )

                    if custom_mode:
                        wind_flyable = (
                            float(pf["wind_speed"][i] or 0) >= wind_min
                            and float(pf["wind_gusts"][i] or 0) <= wind_max
                        )
                    else:
                        wind_ranges = eff_ranges[pt_idx]
                        wind_flyable = any(
                            float(pf["wind_speed"][i]  or 0) > wing["range"][0]
                            and float(pf["wind_gusts"][i] or 0) < wing["range"][1]
                            for wing in wind_ranges
                        )

                    flyable = (
                        in_window
                        and float(pf["precipitation"][i] or 0) <= 0.1
                        and float(pf["visibility"][i]    or 9999) > 299
                        and wind_flyable
                    )

                    t_shifted = (t - timedelta(days=day_idx)).isoformat()

                    if flyable:
                        rel = float(pf["wind_direction"][i] or 0) - point["heading"]
                        if rel > 180:
                            rel -= 360
                        elif rel < -180:
                            rel += 360
                        if point["head_range"]["cross"][0] < rel < point["head_range"]["good"][0]:
                            cat = "cross"
                            wind_pizza[0] += 1
                        elif point["head_range"]["good"][0] <= rel <= point["head_range"]["good"][1]:
                            cat = "good"
                            wind_pizza[1] += 1
                        elif point["head_range"]["good"][1] < rel < point["head_range"]["cross"][1]:
                            cat = "cross"
                            wind_pizza[2] += 1
                        else:
                            cat = "no"
                    else:
                        cat = "no"

                    if cat != "no" and float(pf["wind_gusts"][i]) - float(pf["wind_speed"][i]) > 20:
                        cat += "_gusty"

                    if "good" in cat:
                        if "gusty" in cat:
                            wind_quality[2] += 1
                        else:
                            wind_quality[0] += 1
                    elif "cross" in cat:
                        if "gusty" in cat:
                            wind_quality[3] += 1
                        else:
                            wind_quality[1] += 1

                    if cat != prev:
                        if prev is not None:
                            gantt.append({"type": prev, "start": start, "end": t_shifted})
                        prev  = cat
                        start = t_shifted
                    last_time = t_shifted

                if prev is not None and last_time:
                    gantt.append({"type": prev, "start": start, "end": last_time})

                day_disp.append({
                    "wind_pizza":    wind_pizza,
                    "good_hours":    wind_quality[0],
                    "cross_hours":   wind_quality[1],
                    "gusty_hours":   wind_quality[2],
                    "cross_gusty_hours":   wind_quality[3],
                    "gantt":         gantt,
                    "wind_ranges":   (
                        [{"key": "custom", "range": [wind_min, wind_max]}]
                        if custom_mode else eff_ranges[pt_idx]
                    ),
                })
            disp.append(day_disp)
        return disp