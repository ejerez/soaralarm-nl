"""
MeasurementService – orchestrates fetching from multiple measurement APIs.

Reads stations_{country}.json to know which APIs and station codes to query,
then delegates to the appropriate meas_fetch_*.py module for each API.
All fetch modules return the same standardised format per station:
    {name, lat, lon,
     wind: {timestamps, wind_min, wind_max} | None,
     heading: {timestamps, values} | None}
"""

import asyncio
import importlib
from typing import Any, Dict

# Auto-discovered fetch modules: keyed by API name (must match keys in stations_*.json).
# Each module must be named meas_fetch_{api}.py and expose a fetch(station_codes) function.
_fetch_cache: Dict[str, Any] = {}


def _get_fetch_fn(api_name: str):
    """Lazily import meas_fetch_{api} and return its fetch function."""
    if api_name not in _fetch_cache:
        try:
            mod = importlib.import_module(f"meas_fetch_{api_name}")
            _fetch_cache[api_name] = mod.fetch
        except (ImportError, AttributeError) as exc:
            print(f"[measurements] WARNING: could not load meas_fetch_{api_name}: {exc}")
            _fetch_cache[api_name] = None
    return _fetch_cache[api_name]


class MeasurementService:
    def __init__(self, stations_config: Dict):
        """
        stations_config: contents of stations_{country}.json, e.g.
            {"rws": ["station1", ...], "nkv": ["213", ...]}
        """
        self.stations_config = stations_config

    async def fetch(self) -> Dict:
        """Fetch measurements from all configured APIs in parallel."""
        loop = asyncio.get_event_loop()

        # Build list of (api_name, future) pairs
        tasks = {}
        for api_name, station_codes in self.stations_config.items():
            fetch_fn = _get_fetch_fn(api_name)
            if not fetch_fn:
                continue
            tasks[api_name] = loop.run_in_executor(None, fetch_fn, station_codes)

        result = {}
        for api_name, future in tasks.items():
            try:
                result[api_name] = await future
            except Exception as exc:
                print(f"[measurements] ERROR fetching {api_name}: {exc}")
                result[api_name] = {}

        return result

    @staticmethod
    def serialize(raw: Dict) -> Dict:
        """
        Convert the raw measurement data to JSON-serialisable format.
        The fetch modules already return serialisable dicts, so this mainly
        strips the internal 'time' key and passes through.
        """
        if not raw:
            return {}
        return {k: v for k, v in raw.items() if k != "time"}
