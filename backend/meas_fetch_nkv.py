"""
NKV (Nederlandse Kitesurfvereniging) measurement fetch module.
Fetches wind speed + gust data from weather2kite.nl.
Returns data in the standardised measurement format.
"""

from datetime import datetime
from typing import Dict, List

import requests


BASE_URL = "https://weather2kite.nl/sc/plotPerLocAndUnitReact.php"
MARKERS_URL = "https://weather2kite.nl/sc/getTableDump.php"

# Cached station names/coords (populated once per fetch cycle)
_markers_cache: Dict | None = None


def _get_markers() -> Dict:
    """Fetch station metadata (name, lat, lon) from the NKV markers endpoint."""
    global _markers_cache
    if _markers_cache is not None:
        return _markers_cache
    try:
        resp = requests.get(
            MARKERS_URL,
            params={"table": "mv_measurement_location_markers", "has_harmonie": "true"},
            timeout=10,
        )
        resp.raise_for_status()
        markers = resp.json()
        _markers_cache = {
            str(m["location_id"]): {
                "name": m.get("location_name", f"NKV {m['location_id']}"),
                "lat": float(m["n"]) if "n" in m else None,
                "lon": float(m["e"]) if "e" in m else None,
            }
            for m in markers
            if "location_id" in m
        }
    except Exception:
        _markers_cache = {}
    return _markers_cache


def _fetch_station(station_code: str) -> Dict:
    """Fetch wind speed + gust for a single NKV station, yesterday + today."""
    all_speed = []   # [(unix_ms, m/s), ...]
    all_gust = []

    for day in ["yesterday", "today"]:
        resp = requests.get(BASE_URL, params={
            "json": "",
            "jsonOnly": "",
            "unit": "m/s",
            "location": station_code,
            "day": day,
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

    # Build standardised output
    markers = _get_markers()
    meta = markers.get(str(station_code), {"name": f"NKV {station_code}", "lat": None, "lon": None})

    entry = {"name": meta["name"], "lat": meta["lat"], "lon": meta["lon"]}

    if all_speed or all_gust:
        # Align speed and gust by timestamp
        speed_by_ts = {t: v * 3.6 for t, v in all_speed}  # m/s → km/h
        gust_by_ts  = {t: v * 3.6 for t, v in all_gust}

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

    entry["heading"] = None  # NKV stations don't provide heading data

    return entry


def fetch(station_codes: List[str]) -> Dict[str, Dict]:
    """
    Fetch wind measurements from NKV for the given station codes.

    Returns {station_code: {name, lat, lon,
        wind: {timestamps, wind_min, wind_max},
        heading: None}}
    """
    global _markers_cache
    _markers_cache = None  # reset cache each fetch cycle

    result = {}
    for code in station_codes:
        try:
            result[code] = _fetch_station(code)
        except Exception as exc:
            print(f"[nkv] ERROR fetching station {code}: {exc}")

    return result
