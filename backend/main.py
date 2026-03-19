import asyncio
import json
import pickle
from datetime import datetime, time, timedelta
from json import load
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, BackgroundTasks, Query, Body
from fastapi.middleware.cors import CORSMiddleware

from forecast_service import ForecastService, point_ranges
from measurement_service import MeasurementService

app = FastAPI(title="Soaralarm NL API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Global in-memory state ──────────────────────────────────────────────────
state = {
    "soar_points": [],
    "points_enriched": [],   # soar_points + computed wind_range & head_range, served via API
    "countries": {},
    "modes": {},
    "models": {},
    "wings": {},
    "ranges": {},
    "country": "",           # active country code (e.g. "nl")
    "mode": "",              # active mode code (e.g. "para")
    "raw_forecast": {},
    "forecast": {},
    "stations": {},
    "measurements": {},
    "updating_forecast": False,
    "updating_measurements": False,
}

# ── Display result cache ─────────────────────────────────────────────────────
# Keyed by (model, time_start, time_end, wings_json, weight, wind_min, wind_max).
# Cleared whenever a fresh forecast is fetched.
_display_cache: dict = {}

CONFIG_DIR   = Path("config")
PKL_DIR      = Path("pkl")
FORECAST_TTL = 7200   # 2 hours
MEASURE_TTL  = 900    # 15 minutes


def _load_country_mode(country: str, mode: str):
    """Load all config files for the given country/mode and restore caches."""
    state["country"] = country
    state["mode"]    = mode

    with open(CONFIG_DIR / f"soar_points_{country}.json") as f:
        state["soar_points"] = load(f)
    with open(CONFIG_DIR / f"models_{country}.json") as f:
        state["models"] = load(f)
    with open(CONFIG_DIR / f"wings_{mode}.json") as f:
        state["wings"] = load(f)
    with open(CONFIG_DIR / f"ranges_{mode}.json") as f:
        state["ranges"] = load(f)
    with open(CONFIG_DIR / f"stations_{country}.json") as f:
        state["stations"] = load(f)

    state["points_enriched"] = [
        {**pt, **point_ranges(pt, state["ranges"])} for pt in state["soar_points"]
    ]

    # Restore cached forecast/measurements for this country
    _display_cache.clear()

    forecast_pkl = PKL_DIR / f"forecast_{country}.pkl"
    if forecast_pkl.exists():
        try:
            with open(forecast_pkl, "rb") as f:
                state["forecast"] = pickle.load(f)
            model_keys = list(state["models"].keys())
            if not model_keys or not all(k in state["forecast"] for k in model_keys):
                state["forecast"] = {}
        except Exception:
            state["forecast"] = {}
    else:
        state["forecast"] = {}

    measure_pkl = PKL_DIR / f"measurements_{country}.pkl"
    if measure_pkl.exists():
        try:
            with open(measure_pkl, "rb") as f:
                state["measurements"] = pickle.load(f)
        except Exception:
            state["measurements"] = {}
    else:
        state["measurements"] = {}


# ── Startup ─────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    with open(CONFIG_DIR / "countries.json") as f:
        state["countries"] = load(f)
    with open(CONFIG_DIR / "modes.json") as f:
        state["modes"] = load(f)

    country = list(state["countries"].keys())[0]
    mode    = list(state["modes"].keys())[0]
    _load_country_mode(country, mode)


# ── Helper: stale checks ────────────────────────────────────────────────────
def _forecast_age() -> Optional[float]:
    t = state["forecast"].get("time")
    return (datetime.now() - t).total_seconds() if t else None

def _measure_age() -> Optional[float]:
    t = state["measurements"].get("time")
    return (datetime.now() - t).total_seconds() if t else None

def _in_daylight_window() -> bool:
    """Return True if now is within 90 minutes of today's sunrise/sunset."""
    try:
        from datetime import timezone
        model_keys = list(state["models"].keys())
        forecast = next((state["forecast"].get(k) for k in model_keys if state["forecast"].get(k)), None)
        if not forecast or len(forecast) < 2:
            return True
        today_fc = forecast[1][0] if forecast[1] else None   # dateIdx=1 = today, first point
        if not today_fc or not today_fc.get("sunrise") or not today_fc.get("sunset"):
            return True
        now     = datetime.now(timezone.utc)
        sunrise = datetime.fromisoformat(today_fc["sunrise"])
        sunset  = datetime.fromisoformat(today_fc["sunset"])
        if sunrise.tzinfo is None:
            sunrise = sunrise.replace(tzinfo=timezone.utc)
        if sunset.tzinfo is None:
            sunset  = sunset.replace(tzinfo=timezone.utc)
        margin = timedelta(minutes=90)
        return now >= sunrise - margin and now <= sunset + margin
    except Exception:
        return True


# ── Background workers ───────────────────────────────────────────────────────
async def _refresh_forecast():
    state["updating_forecast"] = True
    try:
        country_cfg = state["countries"].get(state["country"], {})
        timezone    = country_cfg.get("timezone", "Europe/Berlin")
        svc         = ForecastService(state["soar_points"], timezone=timezone)
        models     = state["models"]
        model_keys = list(models.keys())
        default    = model_keys[0]  # first entry is the default / patch source

        # Fetch all models in parallel
        raw_list = await asyncio.gather(*[
            svc.fetch_raw(name, models[name]["resolution"])
            for name in model_keys
        ])
        raws = dict(zip(model_keys, raw_list))

        # Apply patches: copy missing fields from the default model's raw data
        default_raw = raws[default]
        for name in model_keys:
            for field in models[name].get("patch", []):
                for pt_idx in range(len(raws[name])):
                    raws[name][pt_idx]["hourly"][field] = default_raw[pt_idx]["hourly"][field]

        # Process and store; use the model API name as the forecast key
        for name in model_keys:
            state["forecast"][name] = svc.process(raws[name])
        state["forecast"]["time"] = datetime.now()
        _display_cache.clear()
        with open(PKL_DIR / f"forecast_{state['country']}.pkl", "wb") as f:
            pickle.dump(state["forecast"], f, protocol=pickle.HIGHEST_PROTOCOL)
    except Exception as exc:
        print(f"[forecast] ERROR: {exc}")
    finally:
        state["updating_forecast"] = False


async def _refresh_measurements():
    state["updating_measurements"] = True
    try:
        svc = MeasurementService(state["stations"])
        data = await svc.fetch()
        data["time"] = datetime.now()
        state["measurements"] = data
        with open(PKL_DIR / f"measurements_{state['country']}.pkl", "wb") as f:
            pickle.dump(state["measurements"], f, protocol=pickle.HIGHEST_PROTOCOL)
    except Exception as exc:
        print(f"[measurements] ERROR: {exc}")
    finally:
        state["updating_measurements"] = False


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/api/status")
def get_status():
    fa      = _forecast_age()
    ma      = _measure_age()
    in_dl   = _in_daylight_window()
    return {
        "forecast_age_seconds":     fa,
        "measurement_age_seconds":  ma,
        "forecast_stale":           fa is None or fa >= FORECAST_TTL,
        "measurement_stale":        ma is None or ma >= MEASURE_TTL,
        "measurement_in_daylight":  in_dl,
        "updating_forecast":        state["updating_forecast"],
        "updating_measurements":    state["updating_measurements"],
        "forecast_available":       bool(state["models"] and state["forecast"].get(list(state["models"].keys())[0])),
        "measurements_available":   bool(state["measurements"] and "time" in state["measurements"]),
    }


@app.get("/api/points")
def get_points():
    return state["points_enriched"]


@app.get("/api/wings")
def get_wings():
    return state["wings"]


@app.post("/api/forecast/refresh")
async def refresh_forecast(bg: BackgroundTasks):
    if not state["updating_forecast"]:
        bg.add_task(_refresh_forecast)
        return {"status": "started"}
    return {"status": "already_running"}


@app.post("/api/measurements/refresh")
async def refresh_measurements(bg: BackgroundTasks):
    if not state["updating_measurements"]:
        bg.add_task(_refresh_measurements)
        return {"status": "started"}
    return {"status": "already_running"}


@app.get("/api/forecast/display")
def get_display_forecast(
    model:      str           = Query(None),
    time_start: str           = Query("00:00"),
    time_end:   str           = Query("23:59"),
    wings:      str           = Query(None, description='JSON array of {key, size} objects'),
    weight:     float         = Query(70.0, description='Total pilot weight in flight (kg)'),
    wind_min:   Optional[float] = Query(None, description='Custom minimum wind speed (km/h)'),
    wind_max:   Optional[float] = Query(None, description='Custom maximum gust speed (km/h)'),
):
    """Returns per-day, per-point display data (gantt, wind_pizza, hours)."""
    # If a forecast refresh is in progress the data may be partially written —
    # return a clean pending response rather than risking a mid-write crash.
    if state["updating_forecast"]:
        return {"error": "forecast updating, please retry shortly"}

    # Default to first configured model if none specified
    if not model:
        model_keys = list(state["models"].keys())
        model = model_keys[0] if model_keys else None

    raw = state["forecast"].get(model)
    if not raw:
        return {"error": "forecast not available"}

    t_start = time.fromisoformat(time_start)
    t_end   = time.fromisoformat(time_end)

    # Decode the wings array sent by the frontend
    selected_wings: List[dict] = []
    if wings:
        try:
            selected_wings = json.loads(wings)
        except (json.JSONDecodeError, TypeError):
            selected_wings = []

    # Normalise the wings JSON for use as a cache key
    wings_key = json.dumps(selected_wings, sort_keys=True)

    def _cached_display(mk: str, ignore_precip_vis: bool = False):
        """Return display result for model mk, computing and caching if needed."""
        cache_key = (mk, time_start, time_end, wings_key, weight, wind_min, wind_max, ignore_precip_vis)
        if cache_key in _display_cache:
            return _display_cache[cache_key]
        raw_mk = state["forecast"].get(mk)
        if not raw_mk:
            return None
        try:
            svc = ForecastService(state["soar_points"], timezone=state["countries"].get(state["country"], {}).get("timezone", "Europe/Berlin"))
            result = svc.display(raw_mk, t_start, t_end, selected_wings, state["wings"], state["ranges"],
                                 weight, wind_min, wind_max, ignore_precip_vis=ignore_precip_vis)
        except Exception as exc:
            print(f"[display] ERROR for {mk}: {exc}")
            return None
        _display_cache[cache_key] = result
        return result

    disp = _cached_display(model, ignore_precip_vis=False)
    if disp is None:
        return {"error": "forecast not available"}

    # ── Certainty: count model agreement at each day's best location ─────────
    # Uses ignore_precip_vis=True so rain/fog don't reduce confidence scores —
    # confidence reflects wind agreement only; display hours still apply those thresholds.
    ALL_MODELS = list(state["models"].keys())
    model_disps = {mk: _cached_display(mk, ignore_precip_vis=True) for mk in ALL_MODELS if state["forecast"].get(mk)}

    certainty = []
    for day_idx, day_disp in enumerate(disp):
        # Exclude models whose forecast_days cutoff has been exceeded.
        # day_idx=0 is yesterday, day_idx=1 is today; a model with forecast_days=N
        # contributes to scoring only for day_idx <= forecast_days.
        use_models = [m for m in ALL_MODELS
                      if day_idx <= state["models"].get(m, {}).get("forecast_days", 999)]
        total = sum(1 for mk in use_models if mk in model_disps and model_disps[mk] is not None)

        # Count model agreement per point — pick the point most models agree is flyable.
        # Tie-break by selected model's total flyable hours, then good hours.
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

        best_pi, best_agree, best_quality, best_fly = 0, -1, -1, -1
        for pi, pf in enumerate(day_disp):
            fly     = pf["good_hours"] + pf["cross_hours"] + pf["gusty_hours"] + pf["cross_gusty_hours"]
            quality = pf["good_hours"] + pf["gusty_hours"]
            ag      = point_agree[pi]
            if (ag > best_agree
                    or (ag == best_agree and quality > best_quality)
                    or (ag == best_agree and quality == best_quality and fly > best_fly)):
                best_agree, best_quality, best_fly, best_pi = ag, quality, fly, pi

        certainty.append({"agree": best_agree, "total": total, "best_pi": best_pi})

    return {"model": model, "display": disp, "certainty": certainty}


@app.get("/api/forecast/raw")
def get_raw_forecast(
    model: str = Query(None),
):
    """Returns full hourly forecast data per day per point for the point-detail view."""
    if state["updating_forecast"]:
        return {"error": "forecast updating, please retry shortly"}
    if not model:
        model_keys = list(state["models"].keys())
        model = model_keys[0] if model_keys else None
    raw = state["forecast"].get(model)
    if not raw:
        return {"error": "forecast not available"}
    return {"model": model, "forecast": raw}


@app.get("/api/measurements")
def get_measurements():
    return MeasurementService.serialize(state["measurements"])


@app.get("/api/models")
def get_models():
    return state["models"]


@app.get("/api/countries")
def get_countries():
    return state["countries"]


@app.get("/api/modes")
def get_modes():
    return state["modes"]


@app.get("/api/config")
def get_config():
    """Active country, mode, their display names, and all available options."""
    return {
        "country": state["country"],
        "country_name": state["countries"].get(state["country"], {}).get("name", state["country"]),
        "mode": state["mode"],
        "mode_name": state["modes"].get(state["mode"], state["mode"]),
        "countries": state["countries"],
        "modes": state["modes"],
    }


@app.post("/api/config")
async def set_config(bg: BackgroundTasks, body: dict = Body(...)):
    """Switch the active country and/or mode, reloading all config files."""
    new_country = body.get("country", state["country"])
    new_mode    = body.get("mode",    state["mode"])

    if new_country not in state["countries"]:
        return {"error": f"unknown country: {new_country}"}
    if new_mode not in state["modes"]:
        return {"error": f"unknown mode: {new_mode}"}

    country_changed = new_country != state["country"]
    mode_changed    = new_mode    != state["mode"]

    if not country_changed and not mode_changed:
        return {"status": "unchanged"}

    _load_country_mode(new_country, new_mode)

    # Trigger background refreshes if data is missing/stale for the new country
    if country_changed:
        if not state["forecast"] or _forecast_age() is None or _forecast_age() >= FORECAST_TTL:
            if not state["updating_forecast"]:
                bg.add_task(_refresh_forecast)
        if not state["measurements"] or _measure_age() is None or _measure_age() >= MEASURE_TTL:
            if not state["updating_measurements"]:
                bg.add_task(_refresh_measurements)

    return {"status": "ok"}


@app.get("/api/days")
def get_days():
    week_days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    wd   = datetime.today().weekday()
    days = ["Yesterday", "Today", "Tomorrow"] + [week_days[(wd + 2 + i) % 7] for i in range(5)]
    return {"days": days}