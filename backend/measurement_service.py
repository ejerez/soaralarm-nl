"""
MeasurementService – orchestrates fetching from country-level measurement modules.

Each country has a single meas_fetch_{country}.py module that fetches all
measurement data for that country (wind stations, rain tiles, nowcast, etc.).
The module must expose a fetch(stations_config, soar_points) function that
returns a dict with at least the per-API station data, plus optional keys
like "rain_tiles" and "short_term_precipitation".
"""

import asyncio
import importlib
from typing import Any, Dict, List

# Lazily imported fetch modules, keyed by country code.
_fetch_cache: Dict[str, Any] = {}


def _get_fetch_fn(country: str):
    """Lazily import meas_fetch_{country} and return its fetch function."""
    if country not in _fetch_cache:
        try:
            mod = importlib.import_module(f"meas_fetch_{country}")
            _fetch_cache[country] = mod.fetch
        except (ImportError, AttributeError) as exc:
            print(f"[measurements] WARNING: could not load meas_fetch_{country}: {exc}")
            _fetch_cache[country] = None
    return _fetch_cache[country]


class MeasurementService:
    def __init__(self, country: str, stations_config: Dict, soar_points: List):
        """
        Parameters
        ----------
        country : country code, e.g. "nl"
        stations_config : contents of stations_{country}.json,
            e.g. {"rws": ["station1", ...]}
        soar_points : contents of soar_points_{country}.json
        """
        self.country = country
        self.stations_config = stations_config
        self.soar_points = soar_points

    async def fetch(self) -> Dict:
        """Fetch measurements by delegating to the country's fetch module."""
        loop = asyncio.get_event_loop()
        fetch_fn = _get_fetch_fn(self.country)
        if not fetch_fn:
            return {}
        return await loop.run_in_executor(
            None, fetch_fn, self.stations_config, self.soar_points,
        )

    @staticmethod
    def serialize(raw: Dict) -> Dict:
        """
        Convert raw measurement data to JSON-serialisable format.
        Strips the internal 'time' key (cache metadata) and passes through.
        """
        if not raw:
            return {}
        return {k: v for k, v in raw.items() if k != "time"}
