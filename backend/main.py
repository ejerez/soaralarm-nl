import asyncio
import pickle
from datetime import datetime, time
from json import load
from os import path
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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

FORECAST_PKL   = Path("forecast.pkl")
MEASURE_PKL    = Path("measurements.pkl")
POINTS_FILE    = Path("soar_points.json")
WINGS_FILE     = Path("wings.json")
FORECAST_TTL   = 3600   # 1 hour
MEASURE_TTL    = 900    # 15 minutes


# ── Startup ─────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    # Load points
    with open(POINTS_FILE) as f:
        state["soar_points"] = load(f)

    # Load wings
    if WINGS_FILE.exists():
        with open(WINGS_FILE) as f:
            state["wings"] = load(f)

    # Load cached forecast
    if FORECAST_PKL.exists():
        try:
            with open(FORECAST_PKL, "rb") as f:
                state["forecast"] = pickle.load(f)
            # Validate structure
            if "soar_knmi" not in state["forecast"] or "soar_ecmwf" not in state["forecast"]:
                state["forecast"] = {}
        except Exception:
            state["forecast"] = {}

    # Load cached measurements
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


# ── Background workers ───────────────────────────────────────────────────────
async def _refresh_forecast():
    state["updating_forecast"] = True
    try:
        svc = ForecastService(state["soar_points"])
        raw_knmi, raw_ecmwf = await asyncio.gather(
            svc.fetch_raw(model="knmi_seamless"),
            svc.fetch_raw(model="ecmwf_ifs"),
        )
        state["forecast"]["soar_knmi"]  = svc.process(raw_knmi)
        state["forecast"]["soar_ecmwf"] = svc.process(raw_ecmwf)
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
    fa = _forecast_age()
    ma = _measure_age()
    return {
        "forecast_age_seconds":     fa,
        "measurement_age_seconds":  ma,
        "forecast_stale":           fa is None or fa >= FORECAST_TTL,
        "measurement_stale":        ma is None or ma >= MEASURE_TTL,
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
    """Returns all wing definitions from wings.json."""
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
    model: str = Query("soar_knmi", enum=["soar_knmi", "soar_ecmwf"]),
    time_start: str = Query("00:00"),
    time_end:   str = Query("23:59"),
    wing:       Optional[str] = Query(None, description="Wing model key from wings.json"),
    wing_size:  Optional[int] = Query(None, description="Wing size in m²"),
):
    """Returns per-day, per-point display data (gantt, wind_pizza, hours)."""
    raw = state["forecast"].get(model)
    if not raw:
        return {"error": "forecast not available"}

    t_start = time.fromisoformat(time_start)
    t_end   = time.fromisoformat(time_end)

    svc = ForecastService(state["soar_points"])

    # Re-process with wing context so future wing-specific logic can use it
    processed = svc.process(raw, wing=wing, wing_size=wing_size)
    disp = svc.display(processed, t_start, t_end)
    return {"model": model, "display": disp}


@app.get("/api/forecast/raw")
def get_raw_forecast(
    model: str = Query("soar_knmi", enum=["soar_knmi", "soar_ecmwf"]),
):
    """Returns full hourly forecast data per day per point for the point-detail view."""
    raw = state["forecast"].get(model)
    if not raw:
        return {"error": "forecast not available"}
    return {"model": model, "forecast": raw}


@app.get("/api/measurements")
def get_measurements():
    """Returns wind speed + direction measurements per station."""
    svc = MeasurementService(state["soar_points"])
    return svc.serialize(state["measurements"])


@app.get("/api/days")
def get_days():
    """Return the day labels list (Yesterday … +6 days)."""
    from datetime import datetime
    week_days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
    wd = datetime.today().weekday()
    days = ["Yesterday","Today","Tomorrow"] + [week_days[(wd+2+i)%7] for i in range(5)]
    return {"days": days}