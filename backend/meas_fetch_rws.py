"""
RWS (Rijkswaterstaat) measurement fetch module.
Returns data in the standardised measurement format.
"""

import datetime as dt
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Dict, List

import ddlpy
import pandas as pd


def fetch(station_codes: List[str]) -> Dict[str, Dict]:
    """
    Fetch wind measurements from Rijkswaterstaat for the given station codes.

    Returns {station_code: {name, lat, lon,
        wind: {timestamps, wind_min, wind_max},
        heading: {timestamps, values}}}
    """
    locations = ddlpy.locations()

    bool_stations = locations.index.isin(station_codes)
    bool_wind     = locations["Grootheid.Code"].isin(["WINDSHD", "WINDRTG"])
    selected      = locations.loc[bool_stations & bool_wind]

    now   = datetime.now()
    start = dt.datetime.combine((now - timedelta(days=1)).date(), dt.time.min)

    # Fetch all matching rows (station × quantity combinations)
    raw = {}
    for index, row in selected.iterrows():
        meas = ddlpy.measurements(row, start_date=start, end_date=now)
        if meas.empty:
            continue
        if index not in raw:
            raw[index] = {"name": row["Naam"], "lon": row["Lon"], "lat": row["Lat"]}
        raw[index][row["Grootheid.Code"]] = meas[["Meetwaarde.Waarde_Numeriek"]]

    # Convert to standardised format
    result = {}
    for station_code, val in raw.items():
        entry = {"name": val["name"], "lat": val.get("lat"), "lon": val.get("lon")}

        # Wind speed: group by timestamp, take min/max of all readings per interval
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

        # Heading
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
