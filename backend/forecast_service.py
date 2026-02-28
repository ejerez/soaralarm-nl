"""
ForecastService – replaces process_forecast.py with no Streamlit dependency.
All methods take/return plain Python dicts and lists so they can be serialised
to JSON by FastAPI directly.
"""

import asyncio
from datetime import datetime, timedelta, time as time_t
from typing import Any, Dict, List, Optional

import numpy as np
import openmeteo_requests
import pandas as pd
import requests_cache
from retry_requests import retry


class ForecastService:
    BASE_URL = "https://api.open-meteo.com/v1/forecast"

    def __init__(self, soar_points: List[Dict]):
        self.points = soar_points
        cache_session = requests_cache.CachedSession(".cache", expire_after=3600)
        retry_session = retry(cache_session, retries=5, backoff_factor=0.2)
        self._client = openmeteo_requests.Client(session=retry_session)

    # ── Fetch ────────────────────────────────────────────────────────────────
    async def fetch_raw(self, model: str = "knmi_seamless") -> List[Dict]:
        """Fetch Open-Meteo data for all soar points. Returns raw list."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._fetch_blocking, model)

    def _fetch_blocking(self, model: str) -> List[Dict]:
        params = {
            "latitude":  [p["lat"] for p in self.points],
            "longitude": [p["lon"] for p in self.points],
            "daily":     ["sunrise", "sunset"],
            "hourly":    ["temperature_2m", "visibility", "precipitation"],
            "models":    model,
            "timezone":  "Europe/Berlin",
            "past_days": 1,
            "forecast_days": 7,
        }
        offshore_params = {
            "latitude":  [p["offshore_lat"] for p in self.points],
            "longitude": [p["offshore_lon"] for p in self.points],
            "hourly":    ["wind_speed_10m", "wind_direction_10m", "wind_gusts_10m"],
            "models":    model,
            "timezone":  "Europe/Berlin",
            "past_days": 1,
            "forecast_days": 7,
        }

        responses         = self._client.weather_api(self.BASE_URL, params=params)
        offshore_responses = self._client.weather_api(self.BASE_URL, params=offshore_params)

        result = []
        for idx, (resp, off_resp) in enumerate(zip(responses, offshore_responses)):
            hourly         = resp.Hourly()
            offshore_hourly = off_resp.Hourly()

            dates = pd.date_range(
                start=pd.to_datetime(hourly.Time(), unit="s", utc=True),
                end=pd.to_datetime(hourly.TimeEnd(), unit="s", utc=True),
                freq=pd.Timedelta(seconds=hourly.Interval()),
                inclusive="left",
            )

            daily         = resp.Daily()
            daily_dates   = pd.date_range(
                start=pd.to_datetime(daily.Time(), unit="s", utc=True),
                end=pd.to_datetime(daily.TimeEnd(), unit="s", utc=True),
                freq=pd.Timedelta(seconds=daily.Interval()),
                inclusive="left",
            )
            sunrises = pd.to_datetime(daily.Variables(0).ValuesInt64AsNumpy(), unit="s", utc=True)
            sunsets  = pd.to_datetime(daily.Variables(1).ValuesInt64AsNumpy(), unit="s", utc=True)

            result.append({
                "id": idx,
                "hourly": {
                    "date":        [str(d) for d in dates],
                    "temperature": hourly.Variables(0).ValuesAsNumpy().tolist(),
                    "visibility":  hourly.Variables(1).ValuesAsNumpy().tolist(),
                    "precipitation": hourly.Variables(2).ValuesAsNumpy().tolist(),
                    "wind_speed":  offshore_hourly.Variables(0).ValuesAsNumpy().tolist(),
                    "wind_direction": offshore_hourly.Variables(1).ValuesAsNumpy().tolist(),
                    "wind_gusts":  offshore_hourly.Variables(2).ValuesAsNumpy().tolist(),
                },
                "daily": {
                    "date":    [str(d) for d in daily_dates],
                    "sunrise": [str(s) for s in sunrises],
                    "sunset":  [str(s) for s in sunsets],
                },
            })
        return result

    # ── Process ──────────────────────────────────────────────────────────────
    def process(self, raw: List[Dict]) -> List[List[Dict]]:
        """
        Process raw forecast into day×point structure.
        Returns: list[day] of list[point] of hourly dicts.
        """
        # Collect unique dates
        sample_dates = [pd.Timestamp(d).date() for d in raw[0]["daily"]["date"]]
        dates = sorted(set(sample_dates))

        forecast = []
        for date in dates:
            # Per-point sunrise/sunset for this date
            daily_info = []
            for pt_raw in raw:
                for i, d in enumerate(pt_raw["daily"]["date"]):
                    if pd.Timestamp(d).date() == date:
                        daily_info.append({
                            "sunrise": pd.Timestamp(pt_raw["daily"]["sunrise"][i]),
                            "sunset":  pd.Timestamp(pt_raw["daily"]["sunset"][i]),
                        })
                        break

            day_data = []
            for pt_idx, pt_raw in enumerate(raw):
                sr = daily_info[pt_idx]["sunrise"]
                ss = daily_info[pt_idx]["sunset"]
                window_start = sr - timedelta(hours=1)
                window_end   = ss + timedelta(hours=2)

                times = [pd.Timestamp(t) for t in pt_raw["hourly"]["date"]]
                mask  = [(window_start <= t <= window_end) for t in times]

                def _filter(key):
                    return [pt_raw["hourly"][key][i] for i, ok in enumerate(mask) if ok]

                day_data.append({
                    "sunrise":       sr.isoformat(),
                    "sunset":        ss.isoformat(),
                    "time":          [t.isoformat() for t, ok in zip(times, mask) if ok],
                    "temperature":   _filter("temperature"),
                    "visibility":    _filter("visibility"),
                    "precipitation": _filter("precipitation"),
                    "wind_speed":    _filter("wind_speed"),
                    "wind_direction": _filter("wind_direction"),
                    "wind_gusts":    _filter("wind_gusts"),
                })
            forecast.append(day_data)
        return forecast

    # ── Display ──────────────────────────────────────────────────────────────
    def display(
        self,
        forecast: List[List[Dict]],
        t_start: time_t = time_t(0, 0),
        t_end:   time_t = time_t(23, 59),
    ) -> List[List[Dict]]:
        """
        Compute wind_pizza, good_hours, cross_hours, gantt for each day×point.
        """
        disp = []
        for day_idx, day in enumerate(forecast):
            day_disp = []
            for pt_idx, pf in enumerate(day):
                point      = self.points[pt_idx]
                wind_pizza = [0.0, 0.0, 0.0]  # left-cross, good, right-cross
                gantt      = []
                prev       = None
                start      = None
                last_time  = None

                for i, iso_time in enumerate(pf["time"]):
                    t = pd.Timestamp(iso_time)
                    t_local = t.tz_convert("Europe/Amsterdam") if t.tzinfo else t

                    in_window = (
                        t_local.replace(hour=t_start.hour, minute=t_start.minute,
                                        second=0, microsecond=0)
                        <= t_local <=
                        t_local.replace(hour=t_end.hour, minute=t_end.minute,
                                        second=0, microsecond=0)
                    )
                    flyable = (
                        in_window
                        and float(pf["precipitation"][i])  < 0.01
                        and float(pf["visibility"][i])     > 99
                        and float(pf["wind_speed"][i])     > point["wind_range"][0]
                        and float(pf["wind_gusts"][i])     < point["wind_range"][1]
                    )

                    t_shifted = (t - timedelta(days=day_idx)).isoformat()

                    if flyable:
                        rel = float(pf["wind_direction"][i]) - point["heading"]
                        if point["head_range"][0] < rel < -22.5:
                            cat = "cross"
                            wind_pizza[0] += 1
                        elif -22.5 <= rel <= 22.5:
                            cat = "good"
                            wind_pizza[1] += 1
                        elif 22.5 < rel < point["head_range"][1]:
                            cat = "cross"
                            wind_pizza[2] += 1
                        else:
                            cat = "no"
                    else:
                        cat = "no"

                    if cat != prev:
                        if prev is not None:
                            gantt.append({"type": prev, "start": start, "end": t_shifted})
                        prev  = cat
                        start = t_shifted
                    last_time = t_shifted

                if prev is not None and last_time:
                    gantt.append({"type": prev, "start": start, "end": last_time})

                day_disp.append({
                    "wind_pizza":   wind_pizza,
                    "good_hours":   wind_pizza[1],
                    "cross_hours":  wind_pizza[0] + wind_pizza[2],
                    "gantt":        gantt,
                })
            disp.append(day_disp)
        return disp
