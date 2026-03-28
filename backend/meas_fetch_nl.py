"""
Netherlands measurement fetch module.

Consolidates RWS wind, NKV wind, KNMI radar rain tiles, and KNMI nowcast
short-term precipitation into a single country-level fetch.

Returns the standardised measurement format:
    {
        "rws":  {station_code: {name, lat, lon, wind, heading}},
        "nkv":  {station_code: {name, lat, lon, wind, heading}},
        "rain_tiles": {image, bounds, time} | None,
        "short_term_precipitation": [{timestamps, values} | None, ...],
    }
"""

import base64
import datetime as dt
import math
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
#  NKV (weather2kite.nl) wind data
# ═════════════════════════════════════════════════════════════════════════════

_NKV_BASE_URL = "https://weather2kite.nl/sc/plotPerLocAndUnitReact.php"
_NKV_MARKERS_URL = "https://weather2kite.nl/sc/getTableDump.php"
_nkv_markers_cache: Optional[Dict] = None


def _get_nkv_markers() -> Dict:
    """Fetch station metadata (name, lat, lon) from the NKV markers endpoint."""
    global _nkv_markers_cache
    if _nkv_markers_cache is not None:
        return _nkv_markers_cache
    try:
        resp = requests.get(
            _NKV_MARKERS_URL,
            params={"table": "mv_measurement_location_markers", "has_harmonie": "true"},
            timeout=10,
        )
        resp.raise_for_status()
        markers = resp.json()
        _nkv_markers_cache = {
            str(m["location_id"]): {
                "name": m.get("location_name", f"NKV {m['location_id']}"),
                "lat": float(m["n"]) if "n" in m else None,
                "lon": float(m["e"]) if "e" in m else None,
            }
            for m in markers
            if "location_id" in m
        }
    except Exception:
        _nkv_markers_cache = {}
    return _nkv_markers_cache


def _fetch_nkv_station(station_code: str) -> Dict:
    """Fetch wind speed + gust for a single NKV station, yesterday + today."""
    all_speed = []
    all_gust = []

    for day in ["yesterday", "today"]:
        resp = requests.get(_NKV_BASE_URL, params={
            "json": "", "jsonOnly": "", "unit": "m/s",
            "location": station_code, "day": day,
        }, timeout=15)
        resp.raise_for_status()
        payload = resp.json()

        datasets = payload.get("data", {}).get("datasets", [])
        for ds in datasets:
            label = ds.get("label", "")
            points = ds.get("data", [])
            if "voorspelling" in label.lower():
                continue
            if "windsnelheid" in label.lower():
                for pt in points:
                    all_speed.append((pt["x"], pt["y"]))
            elif "windvlaag" in label.lower() or "windstoot" in label.lower():
                for pt in points:
                    all_gust.append((pt["x"], pt["y"]))

    markers = _get_nkv_markers()
    meta = markers.get(str(station_code), {"name": f"NKV {station_code}", "lat": None, "lon": None})
    entry = {"name": meta["name"], "lat": meta["lat"], "lon": meta["lon"]}

    if all_speed or all_gust:
        speed_by_ts = {t: v * 3.6 for t, v in all_speed}  # m/s → km/h
        gust_by_ts = {t: v * 3.6 for t, v in all_gust}
        all_ts = sorted(set(speed_by_ts.keys()) | set(gust_by_ts.keys()))

        timestamps, wind_min, wind_max = [], [], []
        for ts in all_ts:
            spd = speed_by_ts.get(ts)
            gst = gust_by_ts.get(ts)
            if spd is None and gst is None:
                continue
            lo = spd if spd is not None else gst
            hi = gst if gst is not None else spd
            timestamps.append(datetime.fromtimestamp(ts / 1000).isoformat())
            wind_min.append(round(lo, 1))
            wind_max.append(round(hi, 1))

        entry["wind"] = {
            "timestamps": timestamps,
            "wind_min": wind_min,
            "wind_max": wind_max,
        }
    else:
        entry["wind"] = None

    entry["heading"] = None
    return entry


def _fetch_nkv(station_codes: List[str]) -> Dict[str, Dict]:
    """Fetch wind measurements from NKV for the given station codes."""
    global _nkv_markers_cache
    _nkv_markers_cache = None  # reset cache each fetch cycle

    result = {}
    for code in station_codes:
        try:
            result[code] = _fetch_nkv_station(code)
        except Exception as exc:
            print(f"[nl:nkv] ERROR fetching station {code}: {exc}")
    return result


# ═════════════════════════════════════════════════════════════════════════════
#  KNMI Radar: rain tiles + nowcast precipitation
# ═════════════════════════════════════════════════════════════════════════════

def _compute_bounds(soar_points: List[Dict], margin_km: float = 50.0):
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
    south, west, north, east = _compute_bounds(soar_points)

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
        + "&STYLES=rainrate-blue-to-purple/nearest"
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

    Requests the highest available temporal resolution:
      - Every 5 min for 0–2 h
      - Every 25 min for 2–5 h
    Returns {"timestamps": [...], "values": [...]} or None.
    """
    ref_dt = datetime.fromisoformat(ref_time.replace("Z", "+00:00"))

    # Build explicit time steps
    times = []
    for m in range(0, 125, 5):       # 0, 5, 10, …, 120  (25 steps)
        times.append(ref_dt + timedelta(minutes=m))
    for m in range(145, 305, 25):     # 145, 170, …, 295  (7 steps)
        times.append(ref_dt + timedelta(minutes=m))

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
    }
    url = KNMI_WMS_BASE + "&" + "&".join(f"{k}={v}" for k, v in params.items())

    try:
        resp = session.get(url, timeout=20)
        resp.raise_for_status()
        result = resp.json()
    except Exception as exc:
        print(f"[nl:knmi] Nowcast error for ({lat:.3f},{lon:.3f}): {exc}")
        return None

    if not result or not isinstance(result, list) or not result[0].get("data"):
        return None

    # Parse ADAGUC response: {reference_time: {time: value, ...}}
    data = result[0]["data"]
    pairs = []
    for _ref, steps in data.items():
        for t, val in steps.items():
            try:
                pairs.append((t, round(float(val), 2)))
            except (ValueError, TypeError):
                pairs.append((t, None))

    pairs.sort(key=lambda x: x[0])
    if not pairs:
        return None

    return {
        "timestamps": [p[0] for p in pairs],
        "values": [p[1] for p in pairs],
    }


def _fetch_knmi_all(soar_points: List[Dict]) -> Dict:
    """Fetch rain tile image + per-point nowcast precipitation from KNMI."""
    session = requests.Session()
    ref_time = _get_reference_time(session)

    # ── Rain tile ────────────────────────────────────────────────────────────
    rain_tiles = None
    try:
        rain_tiles = _fetch_rain_tile(soar_points, session, ref_time)
    except Exception as exc:
        print(f"[nl:knmi] Rain tile error: {exc}")

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

    return {"rain_tiles": rain_tiles, "short_term_precipitation": short_term}


# ═════════════════════════════════════════════════════════════════════════════
#  Main entry point (called by measurement_service.py)
# ═════════════════════════════════════════════════════════════════════════════

def fetch(stations_config: Dict, soar_points: List[Dict]) -> Dict:
    """
    Fetch all Netherlands measurement data.

    Parameters
    ----------
    stations_config : contents of stations_nl.json,
        e.g. {"rws": ["station1", ...], "nkv": ["213", ...]}
    soar_points : contents of soar_points_nl.json (list of point dicts
        with at least "lat" and "lon" keys)

    Returns
    -------
    dict with keys:
        "rws"   — per-station wind + heading from Rijkswaterstaat
        "nkv"   — per-station wind from NKV
        "rain_tiles" — Leaflet-ready radar image {image, bounds, time}
        "short_term_precipitation" — per-point nowcast [{timestamps, values}, ...]
    """
    result: Dict = {}

    with ThreadPoolExecutor(max_workers=3) as pool:
        rws_future = pool.submit(_fetch_rws, stations_config.get("rws", []))
        nkv_future = pool.submit(_fetch_nkv, stations_config.get("nkv", []))
        knmi_future = pool.submit(_fetch_knmi_all, soar_points)

        try:
            result["rws"] = rws_future.result()
        except Exception as exc:
            print(f"[nl] RWS fetch error: {exc}")
            result["rws"] = {}

        try:
            result["nkv"] = nkv_future.result()
        except Exception as exc:
            print(f"[nl] NKV fetch error: {exc}")
            result["nkv"] = {}

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
