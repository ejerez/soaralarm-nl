# Soaralarm NL — FastAPI + React

A soaring/paragliding wind forecast app for the Dutch coast. Combines four numerical weather models with live RWS coastal measurements to give pilots a 7-day overview of the best spots to fly, plus detailed hourly forecasts per location.

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
        │   └── useSoarData.js   # All data fetching, polling, state, localStorage
        └── components/
            ├── MapForecast.jsx  # Leaflet map + flyable-hours bar + Gantt + confidence
            ├── PointForecast.jsx# Wind speed/dir/temp/precip charts per point
            ├── Settings.jsx     # Model, wings, weight, time window, custom wind range
            ├── Info.jsx         # Flyability docs, wind range table, data sources
            └── WelcomeModal.jsx # First-visit intro modal
```

---

## Quick Start

### 1 — Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API will be at **http://localhost:8000**.  
Interactive docs: **http://localhost:8000/docs**

### 2 — Frontend

```bash
cd frontend
npm install
npm run dev        # dev server at http://localhost:5173
```

For production:
```bash
npm run build      # outputs to frontend/dist/
```

Serve `dist/` with any static file server, or have FastAPI serve it directly:

```python
# Add to main.py
from fastapi.staticfiles import StaticFiles
app.mount("/", StaticFiles(directory="../frontend/dist", html=True), name="static")
```

---

## Features

### Four forecast models
Forecasts are fetched in parallel from [Open-Meteo](https://open-meteo.com/) for all four models on every refresh:

| Key | Model | Resolution | Notes |
|-----|-------|------------|-------|
| `soar_knmi` | **KNMI HARMONIE** | 2 km | HARMONIE AROME for 0–2.5 days, then ECMWF IFS |
| `soar_ecmwf` | **ECMWF IFS** | 9 km | Global, reliable medium-range |
| `soar_icon` | **DWD ICON D2** | 2 km | German NWP, good for the North Sea area |
| `soar_arome` | **Météo-France AROME HD** | 1.3 km | Highest resolution available; visibility patched from KNMI |

The active model is selected in Settings and shown in the date bar. All four models are always fetched and cached regardless of the active selection.

### Multi-model confidence scores
For each day, the backend checks how many of the four models agree that the best location has flyable hours. This agreement score is shown as a colour-coded badge in three places:

- Below the flyable-hours bar chart (one badge per day)
- On each row of the Gantt chart (left column, between the day name and location name)
- In the date/model bar at the top, for the currently selected day

| Period | Confidence levels |
|--------|-------------------|
| Days 0–3: all 4 models used | Very High (4/4) · High (3/4) · Medium (2/4) · Low (1/4) |
| Days 4+: ECMWF, ICON, AROME only | High (3/3) · Medium (2/3) · Low (1/3) |

KNMI is excluded beyond day 3 because it transitions to ECMWF IFS data after 2.5 days, which would effectively double-count the same underlying source.

### Wing- and weight-based wind ranges
Each location has base wind ranges defined per wing type. These are scaled for the pilot's actual wing size and total weight in flight using the constant-lift formula:

```
v₂ = v₁ · √((W₂/W₁) · (A₁/A₂))
```

Up to 5 wings can be selected simultaneously; an hour counts as flyable if it falls within range for **any** selected wing.

### Custom wind range mode
Settings includes a **Custom Wind Range** toggle that disables wing and weight-based calculations entirely, replacing them with a single user-defined minimum wind speed and maximum gust speed applied uniformly to all locations. Useful for experienced pilots who prefer to set their own thresholds directly. Confidence scores also reflect the custom range when it is enabled.

### Wind quality categories
Each flyable hour is classified by wind direction relative to the site's ideal heading:

| Colour | Category | Condition |
|--------|----------|-----------|
| 🟢 Green | Good wind | Wind heading within ideal range |
| 🟠 Orange | Crosswind | Wind heading in cross range |
| 🔴 Dark red | Gusty | Good heading, gusts > 20 km/h over wind speed |
| 🟥 Darker red | Crosswind, Gusty | Cross heading and gusty |

### Live RWS measurements
Wind speed spreads and headings are pulled from [Rijkswaterstaat Waterinfo](https://rijkswaterstaatdata.nl/waterdata/) via [ddlpy](https://github.com/Deltares/ddlpy). Measurements are refreshed every 15 minutes, but only during the daylight window (±90 minutes of sunrise/sunset) to avoid unnecessary API calls overnight.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Forecast/measurement ages, stale flags, updating flags |
| GET | `/api/points` | All soaring point definitions |
| GET | `/api/wings` | Wing type catalogue |
| GET | `/api/days` | Day label list (Yesterday … +6 days) |
| GET | `/api/forecast/display` | Per-day gantt, wind_pizza, hours, certainty scores |
| GET | `/api/forecast/raw` | Full hourly data per day per point |
| GET | `/api/measurements` | Wind speed + direction per station |
| POST | `/api/forecast/refresh` | Trigger background forecast update (all 4 models) |
| POST | `/api/measurements/refresh` | Trigger background measurement update |

### `/api/forecast/display` parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `model` | `soar_knmi` | One of `soar_knmi`, `soar_ecmwf`, `soar_icon`, `soar_arome` |
| `time_start` | `00:00` | Start of pilot availability window |
| `time_end` | `23:59` | End of pilot availability window |
| `wings` | — | JSON array of `{key, size}` objects |
| `weight` | `75.0` | Total pilot weight in flight (kg) |
| `wind_min` | — | Custom minimum wind speed (km/h); activates custom mode when set alongside `wind_max` |
| `wind_max` | — | Custom maximum gust speed (km/h); activates custom mode when set alongside `wind_min` |

---

## Adding Soaring Points

Edit `backend/soar_points.json`. Each point:

```json
{
  "lat": 52.123,
  "lon": 4.456,
  "offshore_lat": 52.120,
  "offshore_lon": 4.400,
  "name": "My Spot",
  "station": "ijmuiden.havenhoofd.zuid",
  "heading": 270,
  "head_range": {
    "good":  [-22.5, 22.5],
    "cross": [-45, 45]
  },
  "wind_range": {
    "scraper_16":    [18, 50],
    "hopper_16":     [20, 40],
    "paraglider_22": [15, 30]
  }
}
```

Wind and gust data are fetched at the **offshore** coordinates; temperature, visibility, and precipitation at the **onshore** (`lat`/`lon`) coordinates. Restart the backend after editing.

## Adding Wing Types

Edit `backend/wings.json`:

```json
{
  "my_wing_15": {
    "display_name": "My Wing Type",
    "default_size": 15,
    "tooltip": "Optional description shown in Settings"
  }
}
```

Then add a matching `my_wing_15` entry to each point's `wind_range` in `soar_points.json`.

---

## Architecture

| Streamlit (original) | FastAPI + React |
|----------------------|-----------------|
| `st.session_state` | In-memory `state` dict in `main.py`; React state in hooks |
| Blocking `asyncio.run()` | `BackgroundTasks` — non-blocking, polled every 10 s |
| `st.spinner` / `st.rerun` | Status badges + auto-polling via `useSoarData` |
| `pickle.load` on every render | Loaded once on startup; persisted after each refresh |
| `folium` maps | Leaflet rendered in the browser |
| `plotly` charts | Recharts rendered in the browser |
| Cookies for settings | `localStorage` — no server round-trip needed |
| `ddlpy` DataFrames | Serialised to JSON by `MeasurementService` |

---

## Development

This project was developed with the assistance of [Claude](https://claude.ai) (Anthropic), which contributed to designing and implementing the FastAPI/React architecture, as well as many of the features of the backend and frontend components.