"""
Netherlands measurement fetch module.

Consolidates RWS wind, KNMI radar rain tiles, and KNMI nowcast
short-term precipitation into a single country-level fetch.

Returns the standardised measurement format:
    {
        "rws":  {station_code: {name, lat, lon, wind, heading}},
        "rain_tiles": {image, bounds, time} | None,
        "short_term_precipitation": [{timestamps, values} | None, ...],
    }
"""

import base64
import datetime as dt
import math
import os
import pickle
import re
import time as time_mod
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

import ddlpy
import pandas as pd
import requests


# ── KNMI WMS configuration ──────────────────────────────────────────────────
KNMI_WMS_BASE = (
    "https://anonymous.api.dataplatform.knmi.nl/wms/adaguc-server"
    "?DATASET=radar_forecast_2.0&SERVICE=WMS&VERSION=1.3.0"
)
KNMI_BATCH_SIZE = 4       # concurrent nowcast requests per batch
KNMI_BATCH_DELAY = 1.0    # seconds pause between batches


# ═════════════════════════════════════════════════════════════════════════════
#  RWS (Rijkswaterstaat) wind data
# ═════════════════════════════════════════════════════════════════════════════

def _fetch_rws(station_codes: List[str]) -> Dict[str, Dict]:
    """Fetch wind measurements from Rijkswaterstaat."""
    locations = ddlpy.locations()

    bool_stations = locations.index.isin(station_codes)
    bool_wind = locations["Grootheid.Code"].isin(["WINDSHD", "WINDRTG"])
    selected = locations.loc[bool_stations & bool_wind]

    now = datetime.now()
    start = dt.datetime.combine((now - timedelta(days=1)).date(), dt.time.min)

    raw = {}
    for index, row in selected.iterrows():
        meas = ddlpy.measurements(row, start_date=start, end_date=now)
        if meas.empty:
            continue
        if index not in raw:
            raw[index] = {"name": row["Naam"], "lon": row["Lon"], "lat": row["Lat"]}
        raw[index][row["Grootheid.Code"]] = meas[["Meetwaarde.Waarde_Numeriek"]]

    result = {}
    for station_code, val in raw.items():
        entry = {"name": val["name"], "lat": val.get("lat"), "lon": val.get("lon")}

        if "WINDSHD" in val:
            df: pd.DataFrame = val["WINDSHD"]
            grouped = defaultdict(list)
            for ts, row in df.iterrows():
                v = row["Meetwaarde.Waarde_Numeriek"]
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
                v = row["Meetwaarde.Waarde_Numeriek"]
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

def _update_scheduled_tiles(soar_points: List[Dict]):
    """
    Update scheduled radar tiles every 15 minutes.
    This ensures we have consistent historical data for animation.
    """
    if not _should_update_scheduled_tiles():
        return
    
    try:
        session = requests.Session()
        ref_time = _get_reference_time(session)
        
        if not ref_time:
            return
        
        # Fetch current tile
        current_tile = _fetch_rain_tile(soar_points, session, ref_time)
        
        if not current_tile:
            return
        
        # Load existing cache
        cache = _load_scheduled_cache()
        now = datetime.now(timezone.utc)
        
        # Add current tile with timestamp
        cache_entry = {
            "tile": current_tile,
            "timestamp": now,
            "reference_time": ref_time
        }
        
        # Keep tiles for the last 65 minutes (to ensure we keep 4 tiles: 45/30/15/0 min)
        recent_tiles = [entry for entry in cache.get("tiles", []) 
                       if (now - entry["timestamp"]).total_seconds() < 3900]
        recent_tiles.append(cache_entry)
        
        cache["tiles"] = recent_tiles
        cache["last_update"] = now
        _save_scheduled_cache(cache)
        
        # Update schedule state
        state = _load_schedule_state()
        state["last_run"] = now
        _save_schedule_state(state)
        

        
    except Exception as exc:
        print(f"[nl:knmi] Scheduled tile update error: {exc}")

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
    
    # Debug: Log cache contents before filtering
    cache_tiles = cache.get("tiles", [])
    print(f"[nl:knmi] Cache contains {len(cache_tiles)} tiles")
    if cache_tiles:
        cache_ages = []
        for entry in cache_tiles:
            minutes_ago = int((now - entry["timestamp"]).total_seconds() / 60)
            cache_ages.append(minutes_ago)
        print(f"[nl:knmi] Cache tile ages: {cache_ages}")
    
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
    
    # Debug: Log tile selection process
    print(f"[nl:knmi] Tile filtering: {len(animation_tiles)} tiles after time filter")
    if animation_tiles:
        # Calculate ages for debugging only
        now = datetime.now(timezone.utc)
        ages = []
        for tile in animation_tiles:
            tile_time = datetime.fromtimestamp(tile["timestamp"] / 1000, timezone.utc)
            minutes_ago = int((now - tile_time).total_seconds() / 60)
            ages.append(minutes_ago)
        print(f"[nl:knmi] Tile ages before count filter: {ages}")
    
    if len(animation_tiles) > 4:
        animation_tiles = animation_tiles[:4]
        print(f"[nl:knmi] Reduced to 4 most recent tiles")
    
    # Sort by timestamp (oldest first) for animation sequence
    animation_tiles.sort(key=lambda x: x["timestamp"])
    
    if animation_tiles:
        # Calculate final ages for debugging only
        now = datetime.now(timezone.utc)
        final_ages = []
        for tile in animation_tiles:
            tile_time = datetime.fromtimestamp(tile["timestamp"] / 1000, timezone.utc)
            minutes_ago = int((now - tile_time).total_seconds() / 60)
            final_ages.append(minutes_ago)
        print(f"[nl:knmi] Final tile ages (oldest to newest): {final_ages}")
    
    # Sort by timestamp (oldest first)
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
        print(f"[nl:knmi] Rain tile fetch error: {exc}")
    return None


def _fetch_point_nowcast(lat: float, lon: float, session: requests.Session,
                         ref_time: str) -> Optional[Dict]:
    """
    Fetch nowcast precipitation time series for a single lat/lon.

    Requests every 5 min for the full 0–5 h range.  The KNMI ADAGUC server
    returns data only for available time steps, giving ~5 min resolution for
    the 0–2 h radar extrapolation and whatever coarser resolution the NWP
    blend provides for 2–5 h.

    Returns {"timestamps": [...], "values": [...]} or None.
    """
    ref_dt = datetime.fromisoformat(ref_time.replace("Z", "+00:00"))

    # Request every 5 min for the full forecast horizon.  The server only
    # returns entries for time steps that have data, so over-requesting is
    # harmless and maximises the chance of hitting the right offsets for the
    # coarser 2–5 h blend.
    times = [ref_dt + timedelta(minutes=m) for m in range(0, 305, 5)]

    time_str = ",".join(t.strftime("%Y-%m-%dT%H:%M:%SZ") for t in times)

    # GetFeatureInfo on a 1×1 pixel bbox centred on the point
    delta = 0.01
    bbox = f"{lat - delta},{lon - delta},{lat + delta},{lon + delta}"
    params = {
        "REQUEST":            "GetFeatureInfo",
        "LAYERS":             "precipitation_nowcast",
        "QUERY_LAYERS":       "precipitation_nowcast",
        "CRS":                "EPSG:4326",
        "BBOX":               bbox,
        "WIDTH":              "1",
        "HEIGHT":             "1",
        "I":                  "0",
        "J":                  "0",
        "INFO_FORMAT":        "application/json",
        "TIME":               time_str,
        "DIM_reference_time": ref_time,
        # Try different styles to get actual precipitation values
        "STYLES":             "rainrate-blue-to-purple/nearest",
    }
    url = KNMI_WMS_BASE + "&" + "&".join(f"{k}={v}" for k, v in params.items())

    try:
        resp = session.get(url, timeout=20)
        resp.raise_for_status()
        result = resp.json()
    except Exception as exc:
        print(f"[nl:knmi] Nowcast error for ({lat:.3f},{lon:.3f}): {exc}")
        return None

    if not result or not isinstance(result, list):
        print(f"[nl:knmi] Invalid response format for ({lat:.3f},{lon:.3f}): {result}")
        return None
    
    if not result[0].get("data"):
        print(f"[nl:knmi] No data field in response for ({lat:.3f},{lon:.3f}). Full response: {result}")
        return None
    
    # Debug: log the structure of the data
    data = result[0]["data"]
    # Parse ADAGUC response: {reference_time: {time: value, ...}}
    pairs = []
    for _ref, steps in data.items():
        for t, val in steps.items():
            try:
                # Convert to float and round to 2 decimal places
                pairs.append((t, round(float(val), 2)))
            except (ValueError, TypeError):
                # Skip invalid values
                continue

    if not pairs:
        return None

    # Sort by timestamp
    pairs.sort(key=lambda x: x[0])
    
    return {
        "timestamps": [p[0] for p in pairs],
        "values": [p[1] for p in pairs],
    }


def _fetch_knmi_all(soar_points: List[Dict]) -> Dict:
    """Fetch rain tile images (current + historical) + per-point nowcast precipitation from KNMI."""
    session = requests.Session()
    ref_time = _get_reference_time(session)

    # ── Rain tiles (current + historical for animation) ─────────────────────
    rain_tiles_list = []
    
    # Fetch current tile
    current_tile = None
    try:
        current_tile = _fetch_rain_tile(soar_points, session, ref_time)
        if current_tile:
            rain_tiles_list.append({
                "image": current_tile["image"],
                "bounds": current_tile["bounds"],
                "time": current_tile["time"]
            })
    except Exception as exc:
        print(f"[nl:knmi] Current rain tile error: {exc}")

    # Use scheduled tile updates for consistent animation
    # This ensures we have fresh tiles every 15 minutes regardless of user activity
    try:
        scheduled_tiles = _get_animation_tiles(soar_points)
        
        if scheduled_tiles:
            # Use scheduled tiles (already include current tile)
            rain_tiles_list = scheduled_tiles
    
        else:
            # Fallback to current tile only
            if current_tile:
                rain_tiles_list.append({
                    "image": current_tile["image"],
                    "bounds": current_tile["bounds"],
                    "time": current_tile["time"]
                })

    except Exception as exc:
        print(f"[nl:knmi] Error getting animation tiles: {exc}")
        # Fallback to current tile
        if current_tile:
            rain_tiles_list.append({
                "image": current_tile["image"],
                "bounds": current_tile["bounds"],
                "time": current_tile["time"]
            })
    
    # Sort by age (oldest first) for animation
    # Sort by timestamp (oldest first) for animation
    # Tiles without timestamp (current tile) go last
    rain_tiles_list.sort(key=lambda x: x.get("timestamp", float('inf')))
    

    
    # ── Nowcast per point (batched to respect rate limits) ───────────────────
    short_term: List[Optional[Dict]] = [None] * len(soar_points)
    if ref_time:
        for batch_start in range(0, len(soar_points), KNMI_BATCH_SIZE):
            batch_end = min(batch_start + KNMI_BATCH_SIZE, len(soar_points))
            with ThreadPoolExecutor(max_workers=KNMI_BATCH_SIZE) as pool:
                futures = {}
                for i in range(batch_start, batch_end):
                    pt = soar_points[i]
                    futures[pool.submit(
                        _fetch_point_nowcast, pt["lat"], pt["lon"],
                        session, ref_time,
                    )] = i
                for future in as_completed(futures):
                    idx = futures[future]
                    try:
                        short_term[idx] = future.result()
                    except Exception as exc:
                        print(f"[nl:knmi] Nowcast error for point {idx}: {exc}")
            if batch_end < len(soar_points):
                time_mod.sleep(KNMI_BATCH_DELAY)

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
    """
    result: Dict = {}

    with ThreadPoolExecutor(max_workers=2) as pool:
        rws_future = pool.submit(_fetch_rws, stations_config.get("rws", []))
        knmi_future = pool.submit(_fetch_knmi_all, soar_points)

        try:
            result["rws"] = rws_future.result()
        except Exception as exc:
            print(f"[nl] RWS fetch error: {exc}")
            result["rws"] = {}

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

    return result
