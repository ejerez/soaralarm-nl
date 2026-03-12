# Soaralarm NL

A paragliding/soaring forecast tool for the Dutch coast. Pulls from four NWP models and live RWS coastal stations to give a 7-day overview of conditions at each spot, plus detailed hourly charts per location.

```
soaralarm/
├── backend/
│   ├── main.py                # FastAPI app & all API routes
│   ├── forecast_service.py    # Open-Meteo fetching & processing
│   ├── measurement_service.py # RWS ddlpy wind measurements
│   ├── soar_points.json       # Soaring point definitions
│   ├── wings.json             # Wing type catalogue
│   └── requirements.txt
└── frontend/
    ├── index.html
    ├── vite.config.js
    ├── package.json
    └── src/
        ├── main.jsx
        ├── App.jsx              # Tab shell, status badges, date/model bar
        ├── api.js               # Thin fetch wrapper for all endpoints
        ├── hooks/
        │   └── useSoarData.js   # All data fetching, polling, caching, state
        └── components/
            ├── MapForecast.jsx  # Leaflet map + flyable-hours bar + Gantt + confidence
            ├── PointForecast.jsx# Wind/direction/temp charts + live measurement band
            ├── Settings.jsx     # Model, wings, weight, time window, custom wind range
            ├── Info.jsx         # Flyability docs, wind range table, data sources
            └── WelcomeModal.jsx # First-visit intro modal
```

---

## Quick start

**Backend**

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

API at `http://localhost:8000` — interactive docs at `/docs`.

**Frontend**

```bash
cd frontend
npm install
npm run dev        # dev server at http://localhost:5173
```

```bash
npm run build      # outputs to frontend/dist/
```

To have FastAPI serve the built frontend:

```python
from fastapi.staticfiles import StaticFiles
app.mount("/", StaticFiles(directory="../frontend/dist", html=True), name="static")
```

---

## Forecast models

All four models are fetched in parallel from [Open-Meteo](https://open-meteo.com/) on every refresh and cached server-side. The active model is selected in Settings; confidence scoring always uses all available models regardless.

| Key | Model | Resolution | Notes |
|-----|-------|------------|-------|
| `soar_knmi` | KNMI HARMONIE | 2 km | HARMONIE AROME for days 0–2, then ECMWF IFS |
| `soar_ecmwf` | ECMWF IFS | 9 km | Reliable medium-range |
| `soar_icon` | DWD ICON D2 | 2 km | Transitions to ICON EU after 72 hours |
| `soar_arome` | Météo-France AROME HD | 1.3 km | Only 4 days; visibility patched from KNMI |

---

## Confidence scores

For each day, the backend counts how many models agree that a given location has flyable hours (rain and fog are excluded from this calculation — they add noise to the agreement score without improving its meaning). The location with the highest agreement is used for the flyable-hours bar, Gantt chart, and as the default in Point Forecast. Ties are broken by the selected model's combined good + gusty hours, then total flyable hours.

KNMI is excluded beyond day 3 because it switches to ECMWF IFS data at ~2.5 days out, which would otherwise double-count the same source.

| Period | Models used | Confidence levels |
|--------|------------|-------------------|
| Days 0–3 | All 4 | Up to Very High (4/4) |
| Day 3+ | ECMWF, ICON, AROME | Up to High (3/3) |
| Day 4+ | ECMWF, ICON | Medium (2/3) and Low (1/3) |

The confidence badge appears in three places: below the flyable-hours bar (one per day), on each Gantt row, and in the date/model bar for the currently selected day.

---

## Wind ranges and flyability

Each location has per-wing-type base wind ranges. When a wing size and pilot weight are set, the range is scaled using the constant-lift formula:

```
v₂ = v₁ · √((W₂/W₁) · (A₁/A₂))
```

Up to 5 wings can be active at once; an hour is flyable if it falls within range for any of them. Alternatively, Settings has a **Custom Wind Range** toggle that bypasses all of this and applies a single user-defined min wind / max gust to all locations.

Each flyable hour is also classified by wind direction relative to the site's ideal heading:

| Category | Condition |
|----------|-----------|
| Good | Wind heading within ideal range |
| Crosswind | Wind heading in cross range |
| Gusty | Good heading, gusts > 20 km/h above wind speed |
| Crosswind + Gusty | Both of the above |

---

## Live measurements

Wind speed and direction are pulled from [Rijkswaterstaat Waterinfo](https://rijkswaterstaatdata.nl/waterdata/) via [ddlpy](https://github.com/Deltares/ddlpy), refreshed every 15 minutes. To avoid unnecessary API calls overnight, refreshes only happen during the daylight window (±90 min of sunrise/sunset).

In Point Forecast, measurements from the nearest RWS station are overlaid on the wind chart as a semi-transparent band showing the min–max spread across sensors at each 10-minute interval.

---

## Caching

The frontend caches all three data types in `localStorage` so every view loads immediately on reload, with a background refresh once the server responds.

| Data | Key | TTL |
|------|-----|-----|
| Display forecast (gantt, hours, certainty) | `soar_display_v1:<settings hash>` | 2 h |
| Raw forecast (hourly per point, for charts) | `soar_raw_v1:<model>` | 2 h |
| Measurements | `soar_measurements_v1` | 15 min |

The display cache is keyed on the full settings combination (model, wings, weight, time window), so changing settings correctly triggers a fresh fetch rather than serving a stale result.

---

## API reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Forecast/measurement ages, stale flags, updating flags |
| GET | `/api/points` | All soaring point definitions |
| GET | `/api/wings` | Wing type catalogue |
| GET | `/api/days` | Day labels (Yesterday … +6 days) |
| GET | `/api/forecast/display` | Per-day gantt, hours, certainty scores |
| GET | `/api/forecast/raw` | Full hourly data per day per point |
| GET | `/api/measurements` | Wind speed + direction per station |
| POST | `/api/forecast/refresh` | Trigger background forecast refresh |
| POST | `/api/measurements/refresh` | Trigger background measurement refresh |

**`/api/forecast/display` parameters**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `model` | `soar_knmi` | Active model |
| `time_start` | `00:00` | Start of pilot availability window |
| `time_end` | `23:59` | End of pilot availability window |
| `wings` | – | JSON array of `{key, size}` objects |
| `weight` | `75.0` | Total pilot weight in flight (kg) |
| `wind_min` | – | Custom minimum wind (km/h); activates custom mode |
| `wind_max` | – | Custom maximum gust (km/h); activates custom mode |

---


## Credits

Built with the help of awesome dutch pilots, as well as [Claude](https://claude.ai) (Anthropic), which contributed to the architecture, backend logic, and frontend implementation throughout development.