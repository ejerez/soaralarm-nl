# Soaralarm NL

A paragliding forecast tool for the Dutch coast. Combines four NWP models with live RWS coastal station data to produce a 7-day soaring outlook per location, plus detailed hourly charts.

Running at [soaralarm.nl](https://soaralarm.nl).

---

## Project layout

```
soaralarm/
├── backend/
│   ├── main.py                # FastAPI app, all routes, confidence scoring
│   ├── forecast_service.py    # Open-Meteo fetching, raw processing, display logic
│   ├── measurement_service.py # RWS ddlpy integration
│   ├── soar_points.json       # Location definitions (coords, headings, wind ranges)
│   ├── wings.json             # Wing type catalogue with base wind ranges
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── App.jsx            # Tab shell, date/model bar, status pills
    │   ├── api.js             # Fetch wrapper with retry logic
    │   ├── hooks/
    │   │   └── useSoarData.js # All data fetching, polling, caching, shared state
    │   └── components/
    │       ├── MapForecast.jsx   # Leaflet map, flyable-hours bar chart, Gantt, confidence
    │       ├── PointForecast.jsx # Hourly wind/direction charts with RWS measurement overlay
    │       ├── Settings.jsx      # Model, wings, weight, time window, custom wind range
    │       ├── Info.jsx          # How flyability is calculated, wind range table, data sources
    │       └── Tutorial.jsx      # First-visit spotlight tutorial (15 steps)
    ├── index.html
    ├── vite.config.js
    └── package.json
```

---

## Getting it running

**Backend**

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Interactive API docs are at `http://localhost:8000/docs`.

**Frontend**

```bash
cd frontend
npm install
npm run dev       # dev server at http://localhost:5173
npm run build     # production build → frontend/dist/
```

The Vite config proxies `/api` to `localhost:8000` in dev, so CORS headers aren't needed locally. In production, nginx handles routing.

To have FastAPI serve the built frontend directly:

```python
from fastapi.staticfiles import StaticFiles
app.mount("/", StaticFiles(directory="../frontend/dist", html=True), name="static")
```

---

## How the backend works

### Forecast models

Four models are fetched in parallel from [Open-Meteo](https://open-meteo.com/) on every refresh and kept in memory, with a pickle to disk so a restart doesn't discard a fresh fetch.

| Key | Model | Notes |
|-----|-------|-------|
| `soar_knmi` | KNMI HARMONIE | HARMONIE AROME days 0–2, then blends into ECMWF IFS |
| `soar_ecmwf` | ECMWF IFS | Most reliable for days 4–7 |
| `soar_icon` | DWD ICON D2 | ICON D2 for 72 h, then ICON EU; 3-hourly after 78 h (interpolated) |
| `soar_arome` | Météo-France AROME HD | Up to 4 days only; visibility patched in from KNMI |

Wind speed, direction and gusts are sampled at hand-picked offshore coordinates upwind of each location. Temperature, visibility and precipitation are sampled at the flying site itself.

### Processing pipeline

`forecast_service.py` handles two stages:

1. **`fetch_raw(model)`** — calls Open-Meteo and returns one dict per point with raw hourly arrays.
2. **`display(raw, ...)`** — classifies each hour as good/crosswind/gusty/etc., builds per-day Gantt intervals, and computes flyable hour totals. Rain and fog windows are tracked separately so they can be displayed without affecting the wind agreement score.

An hour counts as flyable if it's within the wind range for at least one active wing, with precipitation ≤ 0.1 mm and visibility > 300 m. Wind ranges for non-default wing sizes and pilot weights are scaled from the base range using the constant-lift formula:

```
v₂ = v₁ · √((W₂/W₁) · (A₁/A₂))
```

### Confidence scoring

The backend runs `display()` once per model with `ignore_precip_vis=True` (so rain/fog don't interfere with wind agreement), then counts how many models agree there are flyable hours at each location. The location with the best agreement score is used for the bar chart, Gantt chart, and as the Point Forecast default. Ties are broken by good-quality hours (good + gusty), then total flyable hours.

Model availability tapers off for later days:

| Day index | Models used |
|-----------|-------------|
| 0–3 | All 4 |
| 4 | ECMWF, ICON, AROME |
| 5–7 | ECMWF, ICON |

KNMI drops out after day 3 because it switches to ECMWF data at ~2.5 days and would otherwise double-count the same source.

### Server-side display cache

`_cached_display` in `main.py` memoises `display()` results in a plain dict, keyed on `(model, time_start, time_end, wings_json, weight, wind_min, wind_max, ignore_precip_vis)`. The cache is cleared on every fresh forecast fetch. This means confidence scoring — which calls `display()` for all four models — is fast after the first request for a given settings combination.

---

## How the frontend works

### Data flow

`useSoarData.js` owns all remote state. On mount it loads from `localStorage` immediately so the UI is populated before any network round-trip, then fetches fresh data in the background. A `setInterval` poll runs every 10 seconds, checking `/api/status` and triggering a display or measurement refetch whenever the server signals a background update has just finished or data has gone stale.

`dateIdx` and `ptIdx` (currently selected day and location) live inside `useSoarData` rather than in individual components. This lets the map popup's "Detailed Forecast" link switch to the Point tab with the right selections already applied, without either component needing to know about the other.

Fetches use `Promise.allSettled` so a failed measurement fetch — common overnight when RWS stops reporting — doesn't block the forecast from loading.

### Client-side cache

All three data types are cached in `localStorage`:

| Data | Key | TTL |
|------|-----|-----|
| Display forecast (Gantt, hours, certainty) | `soar_display_v1:<settings hash>` | 2 h |
| Raw forecast (hourly per point, for charts) | `soar_raw_v1:<model>` | 2 h |
| Measurements | `soar_measurements_v1` | 15 min |

The display cache key includes the full settings combination, so changing model, wings, weight or the time window triggers a fresh fetch rather than serving a stale result.

### Map tab

`MapForecast.jsx` contains three visualisations that share a single `useMemo` pass over `displayForecast`:

- **Leaflet map** with arrow-shaped polygon overlays per location, sized and coloured by flyable quality. Popups link through to the Point tab with the correct day and location pre-selected.
- **Bar chart** (Recharts) showing stacked flyable-hour categories per day. Rain and fog badges sit in a row above the bars. Clicking a bar selects that day.
- **Gantt chart** (plain SVG) showing flyable windows and weather overlays per day. Layout constants — including the left-label column width — are computed from the container's live pixel width via `ResizeObserver`, so the chart adapts to any screen size without fixed breakpoints.

### Point tab

`PointForecast.jsx` renders Recharts line charts for wind speed and heading for the selected location and day. RWS measurements are overlaid as a semi-transparent band showing the min–max spread across sensors at each 10-minute interval. A wind speed range summary at the bottom shows the effective min/max for each configured wing at that location.

### Tutorial

`Tutorial.jsx` runs a 15-step spotlight tour on first visit (keyed on `localStorage` flag `soaralarm_welcomed`). It can be replayed from the Settings tab. The spotlight tracks the highlighted element via a `requestAnimationFrame` loop so it follows if the page scrolls. Tooltip height is measured after each render with `useLayoutEffect` and used to position the card on the correct side of the spotlight without guessing. When a step requires a different tab, the tutorial switches tabs and retries the element query until it appears in the DOM. The card carries `translate="no"` to stop browser auto-translate from corrupting React's DOM reconciliation.

---

## API reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Forecast/measurement ages, stale flags, updating flags |
| GET | `/api/points` | All soaring point definitions |
| GET | `/api/wings` | Wing type catalogue |
| GET | `/api/days` | Day labels (Yesterday through +6 days) |
| GET | `/api/forecast/display` | Per-day Gantt, hours, certainty — accepts settings params below |
| GET | `/api/forecast/raw` | Full hourly data per point, for the Point tab charts |
| GET | `/api/measurements` | Wind speed and direction per station |
| POST | `/api/forecast/refresh` | Kick off a background forecast refresh |
| POST | `/api/measurements/refresh` | Kick off a background measurement refresh |

**`/api/forecast/display` query parameters**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `model` | `soar_knmi` | Which model to use for display |
| `time_start` | `00:00` | Start of pilot availability window |
| `time_end` | `23:59` | End of pilot availability window |
| `wings` | — | JSON array of `{key, size}` objects |
| `weight` | `75.0` | Total pilot weight in flight (kg) |
| `wind_min` | — | Custom minimum wind (km/h); enables custom mode |
| `wind_max` | — | Custom maximum gust (km/h); enables custom mode |

---

## Credits

Built with the help of awesome Dutch pilots, as well as [Claude](https://www.anthropic.com/claude) (Anthropic), which helped extensively in the design of the web service architecture and frontend development.

Also made possible by [Open-Meteo](https://open-meteo.com/) and the [ddlpy](https://github.com/Deltares/ddlpy) library for RWS data access.