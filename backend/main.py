import asyncio
import json
import pickle
import zoneinfo
from datetime import datetime, time, timedelta, timezone
from json import load
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, BackgroundTasks, Query, Body
from fastapi.middleware.cors import CORSMiddleware

from forecast_service import ForecastService, point_ranges
from measurement_service import MeasurementService

app = FastAPI(title="Soaralarm API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Multi-tenant in-memory state ─────────────────────────────────────────────
# All countries and modes are loaded on startup.  Each API request specifies
# which country/mode it needs via query parameters — no global "active" selection.
state = {
    "countries": {},          # {code: {name, timezone}}
    "modes": {},              # {code: display_name}
    "c": {},                  # per-country: {code: {soar_points, models, stations, forecast, measurements, updating_*}}
    "m": {},                  # per-mode:    {code: {wings, ranges}}
    "enriched": {},           # per country:mode combo: {"nl:para": [enriched points]}
}

# ── Display result cache ─────────────────────────────────────────────────────
# Keyed by (country, mode, model, time_start, time_end, wings_json, weight, wind_min, wind_max, ignore_precip_vis).
# Cleared per-country whenever a fresh forecast is fetched for that country.
_display_cache: dict = {}

CONFIG_DIR   = Path("config")
CACHE_DIR    = Path(".cache")
FORECAST_TTL       = 7200   # 2 hours
MEASURE_TTL_DAY    = 900    # 15 minutes
MEASURE_TTL_NIGHT  = 3600   # 60 minutes


def _load_country(country: str):
    """Load config files for a single country."""
    c = {}
    with open(CONFIG_DIR / f"soar_points_{country}.json", encoding="utf-8") as f:
        c["soar_points"] = load(f)
    with open(CONFIG_DIR / f"models_{country}.json", encoding="utf-8") as f:
        c["models"] = load(f)
    with open(CONFIG_DIR / f"stations_{country}.json", encoding="utf-8") as f:
        c["stations"] = load(f)

    # Restore cached forecast
    c["forecast"] = {}
    forecast_pkl = CACHE_DIR / f"forecast_{country}.pkl"
    if forecast_pkl.exists():
        try:
            with open(forecast_pkl, "rb") as f:
                c["forecast"] = pickle.load(f)
            model_keys = list(c["models"].keys())
            if not model_keys or not all(k in c["forecast"] for k in model_keys):
                c["forecast"] = {}
        except Exception:
            c["forecast"] = {}

    # Restore cached measurements
    c["measurements"] = {}
    measure_pkl = CACHE_DIR / f"measurements_{country}.pkl"
    if measure_pkl.exists():
        try:
            with open(measure_pkl, "rb") as f:
                c["measurements"] = pickle.load(f)
        except Exception:
            c["measurements"] = {}

    c["updating_forecast"] = False
    c["updating_measurements"] = False

    state["c"][country] = c


def _load_mode(mode: str):
    """Load config files for a single mode."""
    m = {}
    with open(CONFIG_DIR / f"wings_{mode}.json", encoding="utf-8") as f:
        m["wings"] = load(f)
    with open(CONFIG_DIR / f"ranges_{mode}.json", encoding="utf-8") as f:
        m["ranges"] = load(f)
    state["m"][mode] = m


def _enrich(country: str, mode: str):
    """Compute enriched points (soar_points + wind_range & head_range) for a country:mode pair."""
    c = state["c"][country]
    m = state["m"][mode]
    key = f"{country}:{mode}"
    state["enriched"][key] = [
        {**pt, **point_ranges(pt, m["ranges"])} for pt in c["soar_points"]
    ]


# ── Startup ──────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    CACHE_DIR.mkdir(exist_ok=True)

    with open(CONFIG_DIR / "countries.json", encoding="utf-8") as f:
        state["countries"] = load(f)
    with open(CONFIG_DIR / "modes.json", encoding="utf-8") as f:
        state["modes"] = load(f)

    # Load all countries and modes
    for country in state["countries"]:
        _load_country(country)
    for mode in state["modes"]:
        _load_mode(mode)

    # Enrich all country × mode combinations
    for country in state["countries"]:
        for mode in state["modes"]:
            _enrich(country, mode)

    # Clear stale display cache entries
    _display_cache.clear()


# ── Helpers ──────────────────────────────────────────────────────────────────
def _get_country(country: str) -> dict:
    """Return per-country state dict, or None if invalid."""
    return state["c"].get(country)

def _get_mode(mode: str) -> dict:
    """Return per-mode state dict, or None if invalid."""
    return state["m"].get(mode)

def _forecast_age(country: str) -> Optional[float]:
    c = state["c"].get(country)
    if not c:
        return None
    t = c["forecast"].get("time")
    return (datetime.now() - t).total_seconds() if t else None

def _measure_age(country: str) -> Optional[float]:
    c = state["c"].get(country)
    if not c:
        return None
    t = c["measurements"].get("time")
    return (datetime.now() - t).total_seconds() if t else None

def _today_sun(country: str):
    """Return (sunrise, sunset) as UTC-aware datetimes for today, or (None, None)."""
    try:
        c = state["c"].get(country)
        if not c:
            return None, None
        model_keys = list(c["models"].keys())
        forecast = next((c["forecast"].get(k) for k in model_keys if c["forecast"].get(k)), None)
        if not forecast or len(forecast) < 2:
            return None, None
        today_fc = forecast[1][0] if forecast[1] else None
        if not today_fc or not today_fc.get("sunrise") or not today_fc.get("sunset"):
            return None, None
        sunrise = datetime.fromisoformat(today_fc["sunrise"])
        sunset  = datetime.fromisoformat(today_fc["sunset"])
        if sunrise.tzinfo is None:
            sunrise = sunrise.replace(tzinfo=timezone.utc)
        if sunset.tzinfo is None:
            sunset  = sunset.replace(tzinfo=timezone.utc)
        return sunrise, sunset
    except Exception:
        return None, None

def _in_daylight_window(country: str) -> bool:
    """Return True if now is within 60 minutes of today's sunrise/sunset."""
    sunrise, sunset = _today_sun(country)
    if sunrise is None:
        return True
    now    = datetime.now(timezone.utc)
    margin = timedelta(minutes=60)
    return now >= sunrise - margin and now <= sunset + margin

def _clear_display_cache_for_country(country: str):
    """Remove all display cache entries for a given country."""
    keys_to_remove = [k for k in _display_cache if k[0] == country]
    for k in keys_to_remove:
        del _display_cache[k]


# ── Background workers ───────────────────────────────────────────────────────
async def _refresh_forecast(country: str):
    c = state["c"].get(country)
    if not c:
        return
    c["updating_forecast"] = True
    try:
        country_cfg = state["countries"].get(country, {})
        timezone    = country_cfg.get("timezone", "Europe/Berlin")
        svc         = ForecastService(c["soar_points"], timezone=timezone)
        models      = c["models"]
        model_keys  = list(models.keys())
        default     = model_keys[0]

        raw_list = await asyncio.gather(*[
            svc.fetch_raw(name, models[name]["resolution"])
            for name in model_keys
        ])
        raws = dict(zip(model_keys, raw_list))

        default_raw = raws[default]
        for name in model_keys:
            for field in models[name].get("patch", []):
                for pt_idx in range(len(raws[name])):
                    raws[name][pt_idx]["hourly"][field] = default_raw[pt_idx]["hourly"][field]

        for name in model_keys:
            c["forecast"][name] = svc.process(raws[name])
        c["forecast"]["time"] = datetime.now()
        _clear_display_cache_for_country(country)
        with open(CACHE_DIR / f"forecast_{country}.pkl", "wb") as f:
            pickle.dump(c["forecast"], f, protocol=pickle.HIGHEST_PROTOCOL)
    except Exception as exc:
        print(f"[forecast:{country}] ERROR: {exc}")
    finally:
        c["updating_forecast"] = False


async def _refresh_measurements(country: str):
    c = state["c"].get(country)
    if not c:
        return
    c["updating_measurements"] = True
    try:
        svc = MeasurementService(country, c["stations"], c["soar_points"])
        data = await svc.fetch()
        data["time"] = datetime.now()
        c["measurements"] = data
        with open(CACHE_DIR / f"measurements_{country}.pkl", "wb") as f:
            pickle.dump(c["measurements"], f, protocol=pickle.HIGHEST_PROTOCOL)
    except Exception as exc:
        print(f"[measurements:{country}] ERROR: {exc}")
    finally:
        c["updating_measurements"] = False


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/api/status")
def get_status(country: str = Query(...)):
    c = _get_country(country)
    if not c:
        return {"error": f"unknown country: {country}"}
    fa    = _forecast_age(country)
    ma    = _measure_age(country)
    in_dl = _in_daylight_window(country)
    meas_ttl = MEASURE_TTL_DAY if in_dl else MEASURE_TTL_NIGHT
    model_keys = list(c["models"].keys())

    # Default time window: truncate sunrise/sunset to hour, add one hour for end time
    sunrise, sunset = _today_sun(country)
    if sunrise is not None:
        tz_name = state["countries"].get(country, {}).get("timezone", "Europe/Berlin")
        local_tz = zoneinfo.ZoneInfo(tz_name)
        # Truncate to the hour and add one hour for the end time
        default_ts = sunrise.astimezone(local_tz).replace(minute=0, second=0, microsecond=0).strftime("%H:%M")
        default_te = sunset.astimezone(local_tz).replace(minute=0, second=0, microsecond=0).strftime("%H:%M")
        # Add one hour to end time
        default_te_h, default_te_m = map(int, default_te.split(':'))
        default_te = f"{(default_te_h + 1):02d}:{default_te_m:02d}"
    else:
        default_ts = "07:00"
        default_te = "21:00"

    # Get rain tile information
    rain_tile_count = 0
    rain_tile_age_seconds = None
    rain_tiles_info = None
    if c["measurements"] and c["measurements"].get("rain_tiles"):
        rain_tiles = c["measurements"]["rain_tiles"]
        rain_tile_count = len(rain_tiles)
        if rain_tile_count > 0:
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            
            # Create detailed tile info array with dynamic ages of all tiles (oldest to newest)
            tiles_info = []
            for tile in rain_tiles:
                if tile.get("timestamp"):
                    tile_time = datetime.fromtimestamp(tile["timestamp"] / 1000, timezone.utc)
                    age_minutes = int((now - tile_time).total_seconds() / 60)
                    tiles_info.append(age_minutes)
                else:
                    # Current tile without timestamp - age is 0
                    tiles_info.append(0)
            rain_tiles_info = tiles_info
            
            # Use the age of the most recent tile (current tile) for backward compatibility
            most_recent_tile = rain_tiles[-1]  # Last tile is most recent
            if most_recent_tile.get("timestamp"):
                tile_time = datetime.fromtimestamp(most_recent_tile["timestamp"] / 1000, timezone.utc)
                rain_tile_age_seconds = int((now - tile_time).total_seconds())
            else:
                # Current tile without timestamp - age is 0
                rain_tile_age_seconds = 0

    return {
        "forecast_age_seconds":     fa,
        "measurement_age_seconds":  ma,
        "forecast_stale":           fa is None or fa >= FORECAST_TTL,
        "measurement_stale":        ma is None or ma >= meas_ttl,
        "measurement_in_daylight":  in_dl,
        "updating_forecast":        c["updating_forecast"],
        "updating_measurements":    c["updating_measurements"],
        "forecast_available":       bool(model_keys and c["forecast"].get(model_keys[0])),
        "measurements_available":   bool(c["measurements"] and "time" in c["measurements"]),
        "rain_tile_count":          rain_tile_count,
        "rain_tile_age_seconds":    rain_tile_age_seconds,
        "rain_tiles_info":          rain_tiles_info,
        "default_time_start":       default_ts,
        "default_time_end":         default_te,
    }


@app.get("/api/points")
def get_points(country: str = Query(...), mode: str = Query(...)):
    key = f"{country}:{mode}"
    enriched = state["enriched"].get(key)
    if enriched is None:
        return {"error": f"unknown country:mode combination: {key}"}
    return enriched


@app.get("/api/wings")
def get_wings(mode: str = Query(...)):
    m = _get_mode(mode)
    if not m:
        return {"error": f"unknown mode: {mode}"}
    return m["wings"]


@app.get("/api/ranges")
def get_ranges(mode: str = Query(...)):
    m = _get_mode(mode)
    if not m:
        return {"error": f"unknown mode: {mode}"}
    return m["ranges"]


@app.get("/api/models")
def get_models(country: str = Query(...)):
    c = _get_country(country)
    if not c:
        return {"error": f"unknown country: {country}"}
    return c["models"]


@app.post("/api/forecast/refresh")
async def refresh_forecast(bg: BackgroundTasks, country: str = Query(...)):
    c = _get_country(country)
    if not c:
        return {"error": f"unknown country: {country}"}
    if not c["updating_forecast"]:
        bg.add_task(_refresh_forecast, country)
        return {"status": "started"}
    return {"status": "already_running"}


@app.post("/api/measurements/refresh")
async def refresh_measurements(bg: BackgroundTasks, country: str = Query(...)):
    c = _get_country(country)
    if not c:
        return {"error": f"unknown country: {country}"}
    if not c["updating_measurements"]:
        bg.add_task(_refresh_measurements, country)
        return {"status": "started"}
    return {"status": "already_running"}


@app.get("/api/forecast/display")
def get_display_forecast(
    country:    str             = Query(...),
    mode:       str             = Query(...),
    model:      str             = Query(None),
    time_start: str             = Query("00:00"),
    time_end:   str             = Query("23:59"),
    wings:      str             = Query(None, description='JSON array of {key, size} objects'),
    weight:     float           = Query(70.0, description='Total pilot weight in flight (kg)'),
    wind_min:   Optional[float] = Query(None, description='Custom minimum wind speed (km/h)'),
    wind_max:   Optional[float] = Query(None, description='Custom maximum gust speed (km/h)'),
):
    """Returns per-day, per-point display data (gantt, wind_pizza, hours)."""
    c = _get_country(country)
    m = _get_mode(mode)
    if not c:
        return {"error": f"unknown country: {country}"}
    if not m:
        return {"error": f"unknown mode: {mode}"}

    if c["updating_forecast"]:
        return {"error": "forecast updating, please retry shortly"}

    if not model:
        model_keys = list(c["models"].keys())
        model = model_keys[0] if model_keys else None

    raw = c["forecast"].get(model)
    if not raw:
        return {"error": "forecast not available"}

    t_start = time.fromisoformat(time_start)
    t_end   = time.fromisoformat(time_end)

    selected_wings: List[dict] = []
    if wings:
        try:
            selected_wings = json.loads(wings)
        except (json.JSONDecodeError, TypeError):
            selected_wings = []

    wings_key = json.dumps(selected_wings, sort_keys=True)

    def _cached_display(mk: str, ignore_precip_vis: bool = False):
        cache_key = (country, mode, mk, time_start, time_end, wings_key, weight, wind_min, wind_max, ignore_precip_vis)
        if cache_key in _display_cache:
            return _display_cache[cache_key]
        raw_mk = c["forecast"].get(mk)
        if not raw_mk:
            return None
        try:
            tz = state["countries"].get(country, {}).get("timezone", "Europe/Berlin")
            svc = ForecastService(c["soar_points"], timezone=tz)
            result = svc.display(raw_mk, t_start, t_end, selected_wings, m["wings"], m["ranges"],
                                 weight, wind_min, wind_max, ignore_precip_vis=ignore_precip_vis)
        except Exception as exc:
            print(f"[display:{country}:{mode}] ERROR for {mk}: {exc}")
            return None
        _display_cache[cache_key] = result
        return result

    disp = _cached_display(model, ignore_precip_vis=False)
    if disp is None:
        return {"error": "forecast not available"}

    # ── Certainty: count model agreement at each day's best location ─────────
    ALL_MODELS = list(c["models"].keys())
    model_disps = {mk: _cached_display(mk, ignore_precip_vis=True) for mk in ALL_MODELS if c["forecast"].get(mk)}

    certainty = []
    for day_idx, day_disp in enumerate(disp):
        use_models = [mk for mk in ALL_MODELS
                      if day_idx <= c["models"].get(mk, {}).get("forecast_days", 999)]
        total = sum(1 for mk in use_models if mk in model_disps and model_disps[mk] is not None)

        n_points = len(day_disp)
        point_agree = [0] * n_points
        for pi in range(n_points):
            for mk in use_models:
                if mk not in model_disps or model_disps[mk] is None:
                    continue
                m_days = model_disps[mk]
                if day_idx < len(m_days) and pi < len(m_days[day_idx]):
                    pf_m = m_days[day_idx][pi]
                    fly_m = (pf_m["good_hours"] + pf_m["cross_hours"]
                             + pf_m["gusty_hours"] + pf_m["cross_gusty_hours"])
                    if fly_m > 0:
                        point_agree[pi] += 1

        best_pi, best_agree, best_prio, best_quality, best_fly = 0, -1, 999, -1, -1
        soar_pts = c["soar_points"]
        for pi, pf in enumerate(day_disp):
            fly     = pf["good_hours"] + pf["cross_hours"] + pf["gusty_hours"] + pf["cross_gusty_hours"]
            quality = pf["good_hours"] + pf["gusty_hours"]
            ag      = point_agree[pi]
            prio    = soar_pts[pi].get("priority", 0) if pi < len(soar_pts) else 0
            if (ag > best_agree
                    or (ag == best_agree and prio < best_prio)
                    or (ag == best_agree and prio == best_prio and quality > best_quality)
                    or (ag == best_agree and prio == best_prio and quality == best_quality and fly > best_fly)):
                best_agree, best_prio, best_quality, best_fly, best_pi = ag, prio, quality, fly, pi

        certainty.append({"agree": best_agree, "total": total, "best_pi": best_pi, "by_point": point_agree})

    return {"model": model, "display": disp, "certainty": certainty}


@app.get("/api/forecast/raw")
def get_raw_forecast(
    country: str = Query(...),
    model:   str = Query(None),
):
    """Returns full hourly forecast data per day per point for the point-detail view."""
    c = _get_country(country)
    if not c:
        return {"error": f"unknown country: {country}"}
    if c["updating_forecast"]:
        return {"error": "forecast updating, please retry shortly"}
    if not model:
        model_keys = list(c["models"].keys())
        model = model_keys[0] if model_keys else None
    raw = c["forecast"].get(model)
    if not raw:
        return {"error": "forecast not available"}
    return {"model": model, "forecast": raw}


@app.get("/api/measurements")
def get_measurements(country: str = Query(...)):
    c = _get_country(country)
    if not c:
        return {"error": f"unknown country: {country}"}
    return MeasurementService.serialize(c["measurements"])


@app.get("/api/countries")
def get_countries():
    return state["countries"]


@app.get("/api/modes")
def get_modes():
    return state["modes"]


@app.get("/api/days")
def get_days():
    week_days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    
    # Get the forecast timestamp to align labels with forecast data
    # If no forecast is available, use current time
    c = state.get("c", {}).get("nl")  # Assuming Netherlands as default country
    forecast_time = c.get("forecast", {}).get("time") if c else None
    
    if forecast_time:
        # Use the forecast's timeline
        base_date = forecast_time.date()
    else:
        # Fallback to current time
        base_date = datetime.today().date()
    
    wd = base_date.weekday()
    
    # Generate labels relative to the base date
    # Yesterday (wd-1), Today (wd), Tomorrow (wd+1), then next 5 days
    days = ["Yesterday", "Today", "Tomorrow"] + [week_days[(wd + 2 + i) % 7] for i in range(5)]
    return {"days": days}


@app.get("/api/whatsnew")
def get_whatsnew():
    p = Path(__file__).resolve().parent / "config" / "whatsnew.json"
    return json.loads(p.read_text(encoding="utf-8"))
