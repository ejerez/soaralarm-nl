"""
Netherlands measurement fetch module.

Consolidates RWS wind, KNMI radar rain tiles, and pysteps-based
short-term precipitation nowcasting into a single country-level fetch.

Returns the standardised measurement format:
    {
        "rws":  {station_code: {name, lat, lon, wind, heading}},
        "rain_tiles": {image, bounds, time} | None,
        "short_term_precipitation": [{timestamps, values} | None, ...],
    }
"""

import base64
import datetime as dt
import io
import math
import os
import pickle
import re
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

import ddlpy
import h5py
import numpy as np
import pandas as pd
import pyproj
import requests


# ── KNMI WMS configuration ──────────────────────────────────────────────────
KNMI_WMS_BASE = (
    "https://anonymous.api.dataplatform.knmi.nl/wms/adaguc-server"
    "?DATASET=radar_forecast_2.0&SERVICE=WMS&VERSION=1.3.0"
)

# ── KNMI Open Data API (raw radar HDF5) ─────────────────────────────────────
KNMI_OD_BASE = "https://api.dataplatform.knmi.nl/open-data/v1"
KNMI_OD_KEY = (
    "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6ImVlNDFjMWI0Mjlk"
    "ODQ2MThiNWI4ZDViZDAyMTM2YTM3IiwiaCI6Im11cm11cjEyOCJ9"
)
KNMI_RADAR_DATASET = "nl_rdr_data_rtcor_5m"
KNMI_RADAR_VERSION = "1.0"

# ── Radar grid metadata (NL25 stereographic, 1 km) ─────────────────────────
_RADAR_PROJ4 = (
    "+proj=stere +lat_0=90 +lon_0=0 +lat_ts=60"
    " +a=6378140 +b=6356750 +x_0=0 +y_0=0"
)
_RADAR_NROWS = 765
_RADAR_NCOLS = 700
_RADAR_X1 = 0.0
_RADAR_Y1 = -4415003.0
_RADAR_X2 = 700002.0
_RADAR_Y2 = -3649999.0
_RADAR_XPIX = abs(_RADAR_X2 - _RADAR_X1) / _RADAR_NCOLS
_RADAR_YPIX = abs(_RADAR_Y2 - _RADAR_Y1) / _RADAR_NROWS
_RADAR_PROJ = pyproj.Proj(_RADAR_PROJ4)

# ── Nowcast config ──────────────────────────────────────────────────────────
NOWCAST_LEADTIMES = 24     # 2 hours at 5-min steps
NOWCAST_MIN_FRAMES = 3


# ═════════════════════════════════════════════════════════════════════════════
#  RWS (Rijkswaterstaat) wind data
# ═════════════════════════════════════════════════════════════════════════════

_RWS_API_URL = (
    "https://ddapi20-waterwebservices.rijkswaterstaat.nl"
    "/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen"
)
_RWS_TIMEOUT = 25


def _rws_fetch_measurements(
    station_code: str, grootheid: str, hoedanigheid: str,
    start_date: datetime, end_date: datetime,
) -> pd.DataFrame:
    """Fetch measurements from RWS API using a minimal metadata request.

    The RWS server started timing out (504) in June 2026 when the full
    AquoMetadata is sent together.  We only send Grootheid + Hoedanigheid.
    """
    dfs = []
    chunk_start = start_date
    while chunk_start < end_date:
        chunk_end = min(chunk_start + timedelta(days=7), end_date)
        request = {
            "AquoPlusWaarnemingMetadata": {
                "AquoMetadata": {
                    "Grootheid": {"Code": grootheid},
                    "Hoedanigheid": {"Code": hoedanigheid},
                },
            },
            "Locatie": {"Code": station_code},
            "Periode": {
                "Begindatumtijd": chunk_start.isoformat(
                    timespec="milliseconds"
                ),
                "Einddatumtijd": chunk_end.isoformat(
                    timespec="milliseconds"
                ),
            },
        }
        try:
            resp = requests.post(
                _RWS_API_URL, json=request, timeout=_RWS_TIMEOUT,
            )
        except requests.exceptions.ReadTimeout:
            chunk_start = chunk_end
            continue
        if resp.status_code == 204:
            chunk_start = chunk_end
            continue
        if resp.status_code != 200:
            chunk_start = chunk_end
            continue
        try:
            data = resp.json()
        except Exception:
            chunk_start = chunk_end
            continue
        for waarneming in data.get("WaarnemingenLijst", []):
            for meting in waarneming.get("MetingenLijst", []):
                ts = meting.get("Tijdstip")
                val = meting.get("Meetwaarde", {}).get("Waarde_Numeriek")
                qc = (
                    meting.get("WaarnemingMetadata", {})
                    .get("Kwaliteitswaardecode", "00")
                )
                if ts is not None and val is not None and qc != "99":
                    dfs.append(
                        {"time": pd.Timestamp(ts), "value": float(val)}
                    )
        chunk_start = chunk_end
    if not dfs:
        return pd.DataFrame()
    df = pd.DataFrame(dfs).set_index("time")
    return df


def _fetch_rws(station_codes: List[str]) -> Dict[str, Dict]:
    """Fetch wind measurements from Rijkswaterstaat."""
    locations = ddlpy.locations()

    bool_stations = locations.index.isin(station_codes)
    bool_wind = locations["Grootheid.Code"].isin(["WINDSHD", "WINDRTG"])
    selected = locations.loc[bool_stations & bool_wind]

    now = datetime.now(timezone.utc)
    start = dt.datetime.combine(
        (now - timedelta(days=1)).date(), dt.time.min, tzinfo=timezone.utc
    )

    station_meta: Dict[str, Dict] = {}
    for idx, row in selected.iterrows():
        if idx not in station_meta:
            station_meta[idx] = {
                "name": row["Naam"],
                "lon": row["Lon"],
                "lat": row["Lat"],
                "grootheden": set(),
            }
        station_meta[idx]["grootheden"].add(row["Grootheid.Code"])

    raw: Dict[str, Dict] = {}
    for station_code, meta in station_meta.items():
        entry = {
            "name": meta["name"],
            "lon": meta["lon"],
            "lat": meta["lat"],
        }
        for grootheid in meta["grootheden"]:
            hoedanigheid = "MSL" if grootheid == "WINDSHD" else "WARNDN"
            df = _rws_fetch_measurements(
                station_code, grootheid, hoedanigheid, start, now,
            )
            if not df.empty:
                entry[grootheid] = df
        raw[station_code] = entry

    result = {}
    for station_code, val in raw.items():
        entry = {"name": val["name"], "lat": val.get("lat"), "lon": val.get("lon")}

        if "WINDSHD" in val:
            df: pd.DataFrame = val["WINDSHD"]
            grouped = defaultdict(list)
            for ts, row in df.iterrows():
                v = row["value"]
                if pd.notna(v):
                    grouped[ts].append(v * 3.6)  # m/s → km/h

            timestamps, wind_min, wind_max = [], [], []
            for ts in sorted(grouped.keys()):
                vals = grouped[ts]
                timestamps.append(ts.isoformat())
                wind_min.append(round(min(vals), 1))
                wind_max.append(round(max(vals), 1))

            entry["wind"] = {
                "timestamps": timestamps,
                "wind_min": wind_min,
                "wind_max": wind_max,
            }
        else:
            entry["wind"] = None

        if "WINDRTG" in val:
            df: pd.DataFrame = val["WINDRTG"]
            timestamps, values = [], []
            for ts, row in df.iterrows():
                v = row["value"]
                if pd.notna(v):
                    timestamps.append(ts.isoformat())
                    values.append(round(float(v), 1))
            entry["heading"] = {"timestamps": timestamps, "values": values}
        else:
            entry["heading"] = None

        result[station_code] = entry

    return result


# ═════════════════════════════════════════════════════════════════════════════
#  Scheduled radar tile cache for consistent animation
# ═════════════════════════════════════════════════════════════════════════════

CACHE_DIR = ".cache"
os.makedirs(CACHE_DIR, exist_ok=True)
CACHE_FILE = os.path.join(CACHE_DIR, "radar_tiles_scheduled.pkl")
SCHEDULE_FILE = os.path.join(CACHE_DIR, "radar_schedule_state.pkl")
NOWCAST_CACHE_FILE = os.path.join(CACHE_DIR, "nowcast_cache.pkl")

def _load_scheduled_cache():
    """Load scheduled radar tile cache."""
    try:
        if os.path.exists(CACHE_FILE):
            with open(CACHE_FILE, "rb") as f:
                return pickle.load(f)
    except Exception:
        pass
    return {"tiles": [], "last_update": None}

def _save_scheduled_cache(cache):
    """Save scheduled radar tiles to cache."""
    try:
        with open(CACHE_FILE, "wb") as f:
            pickle.dump(cache, f)
    except Exception as exc:
        print(f"[nl:knmi] Scheduled cache save error: {exc}")

def _load_schedule_state():
    """Load schedule state."""
    try:
        if os.path.exists(SCHEDULE_FILE):
            with open(SCHEDULE_FILE, "rb") as f:
                return pickle.load(f)
    except Exception:
        pass
    return {"last_run": None}

def _save_schedule_state(state):
    """Save schedule state."""
    try:
        with open(SCHEDULE_FILE, "wb") as f:
            pickle.dump(state, f)
    except Exception as exc:
        print(f"[nl:knmi] Schedule state save error: {exc}")

def _should_update_scheduled_tiles():
    """Check if we should update scheduled tiles (every 15 minutes)."""
    now = datetime.now(timezone.utc)
    state = _load_schedule_state()
    
    # If never run before, run immediately
    if state.get("last_run") is None:
        return True
    
    # Check if 15 minutes have passed since last update
    time_since_last = (now - state["last_run"]).total_seconds()
    if time_since_last >= 15 * 60:
        return True
    
    # Also check if we're at a 15-minute boundary (:00, :15, :30, :45)
    # and it's been at least 14 minutes since last update
    if now.minute % 15 == 0 and now.second < 10:
        if time_since_last >= 14 * 60:
            return True
    
    return False

def _fetch_radar_h5_bytes() -> Optional[bytes]:
    """Download the latest raw radar HDF5 file from KNMI Open Data API."""
    headers = {"Authorization": KNMI_OD_KEY}
    try:
        resp = requests.get(
            f"{KNMI_OD_BASE}/datasets/{KNMI_RADAR_DATASET}"
            f"/versions/{KNMI_RADAR_VERSION}/files",
            headers=headers,
            params={"maxKeys": 1, "sorting": "desc"},
            timeout=15,
        )
        resp.raise_for_status()
        files = resp.json().get("files", [])
        if not files:
            return None
        filename = files[0]["filename"]

        resp2 = requests.get(
            f"{KNMI_OD_BASE}/datasets/{KNMI_RADAR_DATASET}"
            f"/versions/{KNMI_RADAR_VERSION}/files/{filename}/url",
            headers=headers,
            timeout=15,
        )
        resp2.raise_for_status()
        dl_url = resp2.json()["temporaryDownloadUrl"]

        resp3 = requests.get(dl_url, timeout=20)
        resp3.raise_for_status()
        return resp3.content
    except Exception:
        return None


def _parse_radar_h5(h5_bytes: bytes) -> Optional[Dict]:
    """Parse raw radar HDF5 bytes into precipitation array + timestamp."""
    try:
        with h5py.File(io.BytesIO(h5_bytes), "r") as f:
            raw = f["image1/image_data"][:]
            nodata = int(
                f["image1/calibration"].attrs["calibration_missing_data"][0]
            )
            outimg = int(
                f["image1/calibration"].attrs["calibration_out_of_image"][0]
            )
            precip = np.where(
                (raw == nodata) | (raw == outimg),
                np.nan,
                raw * 0.01 * 12.0,
            )

            dt_str = f["overview"].attrs["product_datetime_end"]
            if isinstance(dt_str, bytes):
                dt_str = dt_str.decode()
            ts = datetime.strptime(dt_str, "%d-%b-%Y;%H:%M:%S.%f")
            ts = ts.replace(tzinfo=timezone.utc)

            return {"precip": precip, "timestamp": ts}
    except Exception:
        return None


def _update_scheduled_tiles(soar_points: List[Dict]):
    """
    Update scheduled radar tiles + raw radar frames every 15 minutes.
    """
    if not _should_update_scheduled_tiles():
        return
    
    try:
        session = requests.Session()
        ref_time = _get_reference_time(session)
        
        if not ref_time:
            return
        
        current_tile = _fetch_rain_tile(soar_points, session, ref_time)
        if not current_tile:
            return
        
        # Fetch matching raw radar HDF5
        radar_frame = None
        h5_bytes = _fetch_radar_h5_bytes()
        if h5_bytes:
            radar_frame = _parse_radar_h5(h5_bytes)
        
        cache = _load_scheduled_cache()
        now = datetime.now(timezone.utc)
        
        cache_entry = {
            "tile": current_tile,
            "timestamp": now,
            "reference_time": ref_time,
            "radar_frame": radar_frame,
        }
        
        recent_tiles = [entry for entry in cache.get("tiles", []) 
                       if (now - entry["timestamp"]).total_seconds() < 3900]
        recent_tiles.append(cache_entry)
        
        cache["tiles"] = recent_tiles
        cache["last_update"] = now
        _save_scheduled_cache(cache)
        
        state = _load_schedule_state()
        state["last_run"] = now
        _save_schedule_state(state)

    except Exception:
        pass

def _get_animation_tiles(soar_points: List[Dict]) -> List[Dict]:
    """
    Get tiles for animation from scheduled cache.
    Returns list of tiles with age_minutes for animation.
    """
    # First try to update scheduled tiles
    _update_scheduled_tiles(soar_points)
    
    # Load cache
    cache = _load_scheduled_cache()
    now = datetime.now(timezone.utc)
    
    # Create animation tiles with two-stage filtering:
    # 1. Discard tiles older than 65 minutes (hard limit)
    # 2. Keep only the 4 most recent tiles from what remains
    animation_tiles = []
    
    # Get cache tiles
    cache_tiles = cache.get("tiles", [])
    
    for entry in cache_tiles:
        minutes_ago = int((now - entry["timestamp"]).total_seconds() / 60)
        
        # First filter: discard tiles older than 65 minutes
        if minutes_ago <= 65:
            animation_tiles.append({
                "image": entry["tile"]["image"],
                "bounds": entry["tile"]["bounds"],
                "time": entry["reference_time"],
                "timestamp": int(entry["timestamp"].timestamp() * 1000)  # Convert to milliseconds
            })
    
    # Second filter: sort by timestamp (newest first) and keep only the 4 most recent tiles
    animation_tiles.sort(key=lambda x: x["timestamp"], reverse=True)
    
    if len(animation_tiles) > 4:
        animation_tiles = animation_tiles[:4]
    
    # Sort by timestamp (oldest first) for animation sequence
    animation_tiles.sort(key=lambda x: x["timestamp"])
    
    return animation_tiles


# ═════════════════════════════════════════════════════════════════════════════
#  KNMI Radar: rain tiles + nowcast precipitation
# ═════════════════════════════════════════════════════════════════════════════

def _compute_bounds(soar_points: List[Dict], margin_km: float = 100.0):
    """Compute bounding box from soar points + margin in km."""
    lats = [pt["lat"] for pt in soar_points]
    lons = [pt["lon"] for pt in soar_points]
    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)

    lat_margin = margin_km / 111.0
    center_lat = (min_lat + max_lat) / 2
    lon_margin = margin_km / (111.0 * math.cos(math.radians(center_lat)))

    return (
        min_lat - lat_margin,   # south
        min_lon - lon_margin,   # west
        max_lat + lat_margin,   # north
        max_lon + lon_margin,   # east
    )


def _get_reference_time(session: requests.Session) -> Optional[str]:
    """Fetch the latest reference_time from KNMI WMS GetCapabilities."""
    try:
        resp = session.get(
            KNMI_WMS_BASE + "&REQUEST=GetCapabilities",
            timeout=15,
        )
        resp.raise_for_status()
        m = re.search(r'name="reference_time"[^>]*default="([^"]+)"', resp.text)
        if m:
            return m.group(1)
    except Exception as exc:
        print(f"[nl:knmi] GetCapabilities error: {exc}")
    return None


def _fetch_rain_tile(soar_points: List[Dict], session: requests.Session,
                     ref_time: Optional[str]) -> Optional[Dict]:
    """
    Fetch a single radar rain image covering the soaring area.

    Returns a Leaflet-ready structure:
        {"image": "data:image/png;base64,...",
         "bounds": [[south, west], [north, east]],
         "time": "<reference_time>"}
    """
    south, west, north, east = _compute_bounds(soar_points, margin_km=100.0)

    # Compute proportional image dimensions
    lat_range = north - south
    lon_range = east - west
    center_lat = (south + north) / 2
    aspect = (lon_range * math.cos(math.radians(center_lat))) / lat_range
    width = 800
    height = max(200, int(width / aspect))

    # WMS 1.3.0 + EPSG:4326: BBOX axis order is lat,lon
    bbox = f"{south},{west},{north},{east}"
    url = (
        KNMI_WMS_BASE
        + "&REQUEST=GetMap"
        + "&LAYERS=precipitation_nowcast"
        + "&STYLES=rainrate-grey/linear"
        + "&FORMAT=image/png&TRANSPARENT=true"
        + f"&CRS=EPSG:4326&BBOX={bbox}"
        + f"&WIDTH={width}&HEIGHT={height}"
    )
    if ref_time:
        url += f"&DIM_reference_time={ref_time}"

    try:
        resp = session.get(url, timeout=20)
        resp.raise_for_status()
        if resp.headers.get("content-type", "").startswith("image/"):
            img_b64 = base64.b64encode(resp.content).decode("ascii")
            return {
                "image": f"data:image/png;base64,{img_b64}",
                "bounds": [[south, west], [north, east]],
                "time": ref_time,
            }
    except Exception as exc:
        # Error handling without printing
        pass
    return None


def _latlon_to_pixel(lat: float, lon: float):
    """Convert lat/lon to (row, col) pixel indices in the NL25 radar grid."""
    x, y = _RADAR_PROJ(lon, lat)
    col = int((x - _RADAR_X1) / _RADAR_XPIX)
    row = int((_RADAR_Y2 - y) / _RADAR_YPIX)
    if 0 <= row < _RADAR_NROWS and 0 <= col < _RADAR_NCOLS:
        return row, col
    return None, None


def _run_pysteps_nowcast(
    frames: List[np.ndarray], timestamps: List[datetime],
) -> Optional[Dict]:
    """
    Run pysteps optical-flow extrapolation on the cached radar frames.

    Returns a dict with "precip" (leadtimes x rows x cols) and
    "timestamps" (list of UTC datetimes for each leadtime), or None.
    """
    from pysteps import motion, nowcasts
    from pysteps.utils import transformation

    R_obs = np.stack(frames[-NOWCAST_MIN_FRAMES:])
    R_obs = np.nan_to_num(R_obs, nan=0.0)

    R_dbr, _ = transformation.dB_transform(
        R_obs, None, threshold=0.1, zerovalue=-15.0,
    )
    R_dbr = np.nan_to_num(R_dbr, nan=-15.0)
    R_dbr[~np.isfinite(R_dbr)] = -15.0

    V = motion.get_method("LK")(R_dbr[-NOWCAST_MIN_FRAMES:])
    R_f = nowcasts.get_method("extrapolation")(R_dbr[-1], V, NOWCAST_LEADTIMES)
    R_forecast, _ = transformation.dB_transform(
        R_f, None, threshold=-10.0, inverse=True,
    )

    base_ts = timestamps[-1]
    lead_ts = [base_ts + timedelta(minutes=5 * (i + 1))
               for i in range(NOWCAST_LEADTIMES)]

    return {"precip": R_forecast, "timestamps": lead_ts}


def _extract_point_forecasts(
    nowcast_result: Dict, soar_points: List[Dict],
) -> List[Optional[Dict]]:
    """Extract per-point precipitation time series from pysteps forecast grid."""
    precip = nowcast_result["precip"]
    lead_ts = nowcast_result["timestamps"]
    ts_iso = [t.isoformat() for t in lead_ts]

    results: List[Optional[Dict]] = []
    for pt in soar_points:
        row, col = _latlon_to_pixel(pt["lat"], pt["lon"])
        if row is None:
            results.append(None)
            continue
        values = [round(float(precip[i, row, col]), 2)
                  for i in range(NOWCAST_LEADTIMES)]
        results.append({"timestamps": ts_iso, "values": values})
    return results


def _load_nowcast_cache() -> Dict:
    try:
        if os.path.exists(NOWCAST_CACHE_FILE):
            with open(NOWCAST_CACHE_FILE, "rb") as f:
                return pickle.load(f)
    except Exception:
        pass
    return {"nowcast": None, "timestamp": None}


def _save_nowcast_cache(cache: Dict):
    try:
        with open(NOWCAST_CACHE_FILE, "wb") as f:
            pickle.dump(cache, f)
    except Exception:
        pass


def _get_pysteps_nowcast(soar_points: List[Dict]) -> List[Optional[Dict]]:
    """
    Run pysteps nowcast if enough cached radar frames exist,
    otherwise return the last cached nowcast result.
    """
    _update_scheduled_tiles(soar_points)

    cache = _load_scheduled_cache()
    tiles = cache.get("tiles", [])

    frames, frame_ts = [], []
    for entry in tiles:
        rf = entry.get("radar_frame")
        if rf and rf.get("precip") is not None:
            frames.append(rf["precip"])
            frame_ts.append(rf["timestamp"])

    if len(frames) >= NOWCAST_MIN_FRAMES:
        try:
            nowcast_result = _run_pysteps_nowcast(frames, frame_ts)
            if nowcast_result:
                point_forecasts = _extract_point_forecasts(
                    nowcast_result, soar_points,
                )
                nowcast_cache = {
                    "nowcast": point_forecasts,
                    "timestamp": datetime.now(timezone.utc),
                }
                _save_nowcast_cache(nowcast_cache)
                return point_forecasts
        except Exception:
            pass

    nc_cache = _load_nowcast_cache()
    if nc_cache.get("nowcast") is not None:
        return nc_cache["nowcast"]

    return [None] * len(soar_points)


def _fetch_knmi_all(soar_points: List[Dict]) -> Dict:
    """Fetch rain tile images + pysteps nowcast precipitation from KNMI."""
    session = requests.Session()
    ref_time = _get_reference_time(session)

    # ── Rain tiles (current + historical for animation) ─────────────────────
    rain_tiles_list = []
    
    current_tile = None
    try:
        current_tile = _fetch_rain_tile(soar_points, session, ref_time)
        if current_tile:
            rain_tiles_list.append({
                "image": current_tile["image"],
                "bounds": current_tile["bounds"],
                "time": current_tile["time"],
            })
    except Exception:
        pass

    try:
        scheduled_tiles = _get_animation_tiles(soar_points)
        if scheduled_tiles:
            rain_tiles_list = scheduled_tiles
        elif current_tile:
            rain_tiles_list.append({
                "image": current_tile["image"],
                "bounds": current_tile["bounds"],
                "time": current_tile["time"],
            })
    except Exception:
        if current_tile:
            rain_tiles_list.append({
                "image": current_tile["image"],
                "bounds": current_tile["bounds"],
                "time": current_tile["time"],
            })
    
    rain_tiles_list.sort(key=lambda x: x.get("timestamp", float("inf")))

    # ── Nowcast per point via pysteps ────────────────────────────────────────
    short_term = _get_pysteps_nowcast(soar_points)

    return {"rain_tiles": rain_tiles_list, "short_term_precipitation": short_term}


# ═════════════════════════════════════════════════════════════════════════════
#  Main entry point (called by measurement_service.py)
# ═════════════════════════════════════════════════════════════════════════════

def fetch(stations_config: Dict, soar_points: List[Dict]) -> Dict:
    """
    Fetch all Netherlands measurement data.

    Parameters
    ----------
    stations_config : contents of stations_nl.json,
        e.g. {"rws": ["station1", ...]}
    soar_points : contents of soar_points_nl.json (list of point dicts
        with at least "lat" and "lon" keys)

    Returns
    -------
    dict with keys:
        "rws"   — per-station wind + heading from Rijkswaterstaat
        "rain_tiles" — List of radar images for animation [{image, bounds, time, age_minutes}, ...]
        "short_term_precipitation" — per-point nowcast [{timestamps, values}, ...]
        "_errors" — (optional) per-provider exceptions, keyed by display name
                    ("RWS", "KNMI"). Consumed and stripped by main.py before
                    the result is cached, so it never gets pickled.
    """
    result: Dict = {}
    errors: Dict[str, Exception] = {}

    with ThreadPoolExecutor(max_workers=2) as pool:
        rws_future = pool.submit(_fetch_rws, stations_config.get("rws", []))
        knmi_future = pool.submit(_fetch_knmi_all, soar_points)

        try:
            result["rws"] = rws_future.result()
        except Exception as exc:
            print(f"[nl] RWS fetch error: {exc}")
            result["rws"] = {}
            errors["RWS"] = exc

        try:
            knmi = knmi_future.result()
            result["rain_tiles"] = knmi.get("rain_tiles")
            result["short_term_precipitation"] = knmi.get(
                "short_term_precipitation", []
            )
        except Exception as exc:
            print(f"[nl] KNMI fetch error: {exc}")
            result["rain_tiles"] = None
            result["short_term_precipitation"] = []
            errors["KNMI"] = exc

    if errors:
        result["_errors"] = errors

    return result
