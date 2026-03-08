import asyncio
import json
import pickle
from datetime import datetime, time, timedelta
from json import load
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware

from forecast_service import ForecastService
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
    "wings": {},
    "raw_forecast": {},
    "forecast": {},
    "measurements": {},
    "updating_forecast": False,
    "updating_measurements": False,
}

FORECAST_PKL = Path("forecast.pkl")
MEASURE_PKL  = Path("measurements.pkl")
POINTS_FILE  = Path("soar_points.json")
WINGS_FILE   = Path("wings.json")
FORECAST_TTL = 7200   # 2 hours
MEASURE_TTL  = 900    # 15 minutes


# ── Startup ─────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    with open(POINTS_FILE) as f:
        state["soar_points"] = load(f)

    if WINGS_FILE.exists():
        with open(WINGS_FILE) as f:
            state["wings"] = load(f)

    if FORECAST_PKL.exists():
        try:
            with open(FORECAST_PKL, "rb") as f:
                state["forecast"] = pickle.load(f)
            if not all(k in state["forecast"] for k in ("soar_knmi", "soar_ecmwf", "soar_icon", "soar_arome")):
                state["forecast"] = {}
        except Exception:
            state["forecast"] = {}

    if MEASURE_PKL.exists():
        try:
            with open(MEASURE_PKL, "rb") as f:
                state["measurements"] = pickle.load(f)
        except Exception:
            state["measurements"] = {}


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
        forecast = state["forecast"].get("soar_knmi") or state["forecast"].get("soar_ecmwf")
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
        svc = ForecastService(state["soar_points"])
        raw_knmi, raw_ecmwf, raw_icon, raw_arome = await asyncio.gather(
            svc.fetch_raw(model="knmi_seamless"),
            svc.fetch_raw(model="ecmwf_ifs"),
            svc.fetch_raw(model="icon_seamless"),
            svc.fetch_raw(model="meteofrance_seamless"),
        )
        # Météo-France AROME does not provide visibility forecasts — patch in
        # the KNMI visibility arrays (same onshore coordinates) before processing.
        for pt_idx in range(len(raw_arome)):
            raw_arome[pt_idx]["hourly"]["visibility"] = raw_knmi[pt_idx]["hourly"]["visibility"]
        state["forecast"]["soar_knmi"]  = svc.process(raw_knmi)
        state["forecast"]["soar_ecmwf"] = svc.process(raw_ecmwf)
        state["forecast"]["soar_icon"]  = svc.process(raw_icon)
        state["forecast"]["soar_arome"] = svc.process(raw_arome)
        state["forecast"]["time"]       = datetime.now()
        with open(FORECAST_PKL, "wb") as f:
            pickle.dump(state["forecast"], f, protocol=pickle.HIGHEST_PROTOCOL)
    except Exception as exc:
        print(f"[forecast] ERROR: {exc}")
    finally:
        state["updating_forecast"] = False


async def _refresh_measurements():
    state["updating_measurements"] = True
    try:
        svc = MeasurementService(state["soar_points"])
        data = await svc.fetch()
        state["measurements"] = data
        state["measurements"]["time"] = datetime.now()
        with open(MEASURE_PKL, "wb") as f:
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
        "forecast_available":       bool(state["forecast"].get("soar_knmi")),
        "measurements_available":   bool(state["measurements"] and "time" in state["measurements"]),
    }


@app.get("/api/points")
def get_points():
    return state["soar_points"]


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
    model:      str           = Query("soar_knmi", enum=["soar_knmi", "soar_ecmwf", "soar_icon", "soar_arome"]),
    time_start: str           = Query("00:00"),
    time_end:   str           = Query("23:59"),
    wings:      str           = Query(None, description='JSON array of {key, size} objects'),
    weight:     float         = Query(75.0, description='Total pilot weight in flight (kg)'),
    wind_min:   Optional[float] = Query(None, description='Custom minimum wind speed (km/h); enables custom mode'),
    wind_max:   Optional[float] = Query(None, description='Custom maximum gust speed (km/h); enables custom mode'),
):
    """Returns per-day, per-point display data (gantt, wind_pizza, hours)."""
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

    svc  = ForecastService(state["soar_points"])
    disp = svc.display(raw, t_start, t_end, selected_wings, state["wings"], weight,
                       wind_min=wind_min, wind_max=wind_max)

    # ── Certainty: count model agreement at each day's best location ─────────
    ALL_MODELS = ["soar_knmi", "soar_ecmwf", "soar_icon", "soar_arome"]
    model_disps = {}
    for mk in ALL_MODELS:
        if mk == model:
            model_disps[mk] = disp
        elif state["forecast"].get(mk):
            model_disps[mk] = svc.display(
                state["forecast"][mk], t_start, t_end, selected_wings, state["wings"], weight,
                wind_min=wind_min, wind_max=wind_max,
            )

    certainty = []
    for day_idx, day_disp in enumerate(disp):
        best_pi, best_fly, best_good = 0, 0, -1
        for pi, pf in enumerate(day_disp):
            fly = pf["good_hours"] + pf["cross_hours"] + pf["gusty_hours"] + pf["cross_gusty_hours"]
            if fly > best_fly or (fly == best_fly and pf["good_hours"] > best_good):
                best_fly, best_good, best_pi = fly, pf["good_hours"], pi

        use_models = ALL_MODELS if day_idx < 4 else [m for m in ALL_MODELS if m != "soar_knmi"]
        agree, total = 0, 0
        for mk in use_models:
            if mk not in model_disps:
                continue
            total += 1
            m_days = model_disps[mk]
            if day_idx < len(m_days) and best_pi < len(m_days[day_idx]):
                pf_m = m_days[day_idx][best_pi]
                fly_m = (pf_m["good_hours"] + pf_m["cross_hours"]
                         + pf_m["gusty_hours"] + pf_m["cross_gusty_hours"])
                if fly_m > 0:
                    agree += 1
        certainty.append({"agree": agree, "total": total})

    return {"model": model, "display": disp, "certainty": certainty}


@app.get("/api/forecast/raw")
def get_raw_forecast(
    model: str = Query("soar_knmi", enum=["soar_knmi", "soar_ecmwf", "soar_icon", "soar_arome"]),
):
    """Returns full hourly forecast data per day per point for the point-detail view."""
    raw = state["forecast"].get(model)
    if not raw:
        return {"error": "forecast not available"}
    return {"model": model, "forecast": raw}


@app.get("/api/measurements")
def get_measurements():
    svc = MeasurementService(state["soar_points"])
    return svc.serialize(state["measurements"])


@app.get("/api/days")
def get_days():
    week_days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    wd   = datetime.today().weekday()
    days = ["Yesterday", "Today", "Tomorrow"] + [week_days[(wd + 2 + i) % 7] for i in range(5)]
    return {"days": days}