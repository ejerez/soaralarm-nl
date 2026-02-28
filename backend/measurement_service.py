"""
MeasurementService – replaces get_measured_data.py with no Streamlit dependency.
"""

import asyncio
from datetime import datetime, timedelta, date
import datetime as dt
from typing import Dict, List, Any

import ddlpy
import pandas as pd


STATION_IDS = [
    "ijmuiden.havenhoofd.zuid",
    "stellendam.haringvlietsluizen.schuif1",
    "vlaktevanderaan",
    "brouwersdam.brouwershavensegat.2",
    "oosterschelde.4",
]


class MeasurementService:
    def __init__(self, soar_points: List[Dict]):
        self.points = soar_points

    async def fetch(self) -> Dict:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._fetch_blocking)

    def _fetch_blocking(self) -> Dict:
        locations = ddlpy.locations()

        bool_stations = locations.index.isin(STATION_IDS)
        bool_wind     = locations["Grootheid.Code"].isin(["WINDSHD", "WINDRTG"])
        selected      = locations.loc[bool_stations & bool_wind]

        now    = datetime.now()
        start  = dt.datetime.combine((now - timedelta(days=1)).date(), dt.time.min)
        dates  = (start, now)

        data = {}
        for index, row in selected.iterrows():
            meas = ddlpy.measurements(row, start_date=dates[0], end_date=dates[1])
            if not meas.empty:
                if index not in data:
                    data[index] = {
                        "name": row["Naam"],
                        "lon":  row["Lon"],
                        "lat":  row["Lat"],
                    }
                data[index][row["Grootheid.Code"]] = meas[["Meetwaarde.Waarde_Numeriek"]]

        return data

    def serialize(self, raw: Dict) -> Dict:
        """Convert the raw ddlpy DataFrames into JSON-serialisable dicts."""
        if not raw:
            return {}

        out = {}
        for station_id, val in raw.items():
            if station_id == "time":
                continue
            entry: Dict[str, Any] = {
                "name": val.get("name"),
                "lat":  val.get("lat"),
                "lon":  val.get("lon"),
            }
            for key in ["WINDSHD", "WINDRTG"]:
                if key in val:
                    df: pd.DataFrame = val[key]
                    ts = [t.isoformat() for t in df.index.to_pydatetime()]
                    vs = [
                        v * 3.6 if key == "WINDSHD" else v  # WINDSHD: m/s → km/h; WINDRTG: degrees, no conversion
                        for v in df["Meetwaarde.Waarde_Numeriek"].tolist()
                    ]
                    entry[key] = {"timestamps": ts, "values": vs}
            out[station_id] = entry
        return out
