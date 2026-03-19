# Soaralarm

A paragliding/parakiting forecast tool for coastal dune soaring. Combines multiple NWP models with live coastal station measurements to produce a 7-day soaring outlook per location, plus detailed hourly charts. Designed to support multiple countries and flying modes through a config-driven architecture.

Running at [soaralarm.eu](https://soaralarm.eu) — each country is served on its own subdomain (e.g. [nl.soaralarm.eu](https://nl.soaralarm.eu), dk.soaralarm.eu). The legacy domain [soaralarm.nl](https://soaralarm.nl) redirects to nl.soaralarm.eu.

---

## Project layout

```
soaralarm/
├── backend/
│   ├── main.py                  # FastAPI app, multi-tenant routes, confidence scoring
│   ├── forecast_service.py      # Open-Meteo fetching, raw processing, display logic, point_ranges()
│   ├── measurement_service.py   # Measurement fetching orchestrator (delegates to meas_fetch_*.py)
│   ├── meas_fetch_rws.py        # Rijkswaterstaat measurement API (ddlpy)
│   ├── meas_fetch_nkv.py        # NKV (Nederlands Kitesurf Vereniging) measurement API
│   ├── config/
│   │   ├── countries.json       # Available countries (code → {name, timezone})
│   │   ├── modes.json           # Available flying modes (code → display name)
│   │   ├── soar_points_nl.json  # NL locations (coords, heading, slope, info symbols, links)
│   │   ├── models_nl.json       # NL forecast model definitions (resolution, patches, forecast_days)
│   │   ├── wings_para.json      # Paragliding wing catalogue (display names, default sizes, tooltips)
│   │   ├── ranges_para.json     # Paragliding range calibration (formula strings, steepness, wings)
│   │   └── stations_nl.json     # NL measurement station registry (API → station codes)
│   ├── pkl/                     # Pickle cache for forecast and measurement data (per country)
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── App.jsx              # Tab shell, date bar, loading states
    │   ├── api.js               # Fetch wrapper with retry logic, auto-appends country/mode scope
    │   ├── hooks/
    │   │   └── useSoarData.js   # All data fetching, polling, caching, country/mode switching
    │   └── components/
    │       ├── MapForecast.jsx     # Leaflet map, flyable-hours bar chart, Gantt, confidence
    │       ├── PointForecast.jsx   # Hourly charts, site info symbols, station selector
    │       ├── Settings.jsx        # Country, mode, model, wings, weight, time window, speed units
    │       ├── Info.jsx            # Flyability calculation (formulas from ranges), wind range table
    │       ├── DataSources_nl.jsx  # NL-specific data sources, models, and measurements info
    │       └── Tutorial.jsx        # First-visit spotlight tutorial (per-tab intros + element steps)
    ├── public/
    │   └── symbols/             # Site information symbol PNGs (dune types, hazards, regulations)
    ├── index.html
    ├── vite.config.js
    └── package.json
```

---

## Adding countries and modes

The app is config-driven. To add a new country or mode, add the corresponding config files and the system picks them up automatically.

**Adding a new country** (e.g. Denmark → `dk`):
1. Add `"dk": {"name": "Denmark", "timezone": "Europe/Copenhagen"}` to `countries.json`
2. Create `soar_points_dk.json` — location definitions with coords, heading, slope, info, link
3. Create `models_dk.json` — forecast model configuration (Open-Meteo model names, resolutions)
4. Create `stations_dk.json` — measurement station registry
5. If the country uses a new measurement API, add `meas_fetch_<api>.py`
6. Create `DataSources_dk.jsx` in `frontend/src/components/` — country-specific data sources info for the Info tab (auto-discovered via `import.meta.glob`)
7. Set up subdomain DNS and nginx config (see Deployment section)

**Adding a new mode** (e.g. kiting → `kite`):
1. Add `"kite": "Kiting"` to `modes.json`
2. Create `wings_kite.json` — wing type catalogue with base sizes and tooltips
3. Create `ranges_kite.json` — speed and heading range calibration with formula strings

Caching, pickling, and persistence are all scoped by country and mode codes automatically.

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

### Startup and config loading

On startup, `main.py` reads `countries.json` and `modes.json`, then loads **all** countries and modes simultaneously. For each country it calls `_load_country()` (loading `soar_points_{country}.json`, `models_{country}.json`, `stations_{country}.json` and restoring pickle caches), and for each mode it calls `_load_mode()` (loading `wings_{mode}.json`, `ranges_{mode}.json`). It then enriches every country × mode combination via `point_ranges()`. This means a single backend instance serves all countries and modes — there is no global "active" selection. Each API request specifies which country/mode it needs via query parameters.

### Soaring point enrichment — `point_ranges()`

Each soaring point in `soar_points_{country}.json` defines a `slope` with `steepness` (flat/moderate/steep) and `height` in metres. The `point_ranges()` function in `forecast_service.py` uses these together with the calibration data in `ranges_{mode}.json` to compute:

- **Wind speed ranges** per wing type — minimum speed from steepness category, scaled by a height factor computed from a formula string (e.g. `"(42.0 - 0.2 * height) / 40.0"`); maximum speed per wing, similarly scaled
- **Heading ranges** — half-range computed from a formula string (e.g. `"-3.7922 + 12.8541 * ln(height)"`), with good-heading zone at a configurable fraction of the cross-wind range; individual points can override bounds via an optional `head_range` field

### Formula engine

Speed and heading formulas in `ranges_{mode}.json` are stored as human-readable strings and evaluated at runtime by `_eval_formula()`. This means you can change the function type (e.g. linear → quadratic, logarithmic → exponential) by simply editing the formula string in the JSON — no code changes needed. The evaluator supports `+`, `-`, `*`, `/`, `**`, parentheses, and functions: `ln()`, `log()`, `sqrt()`, `exp()`, `abs()`. The Info tab displays these formulas as-is, so what the user sees always matches what the backend computes.

### Forecast models

Models are defined in `models_{country}.json` and fetched in parallel from [Open-Meteo](https://open-meteo.com/) on every refresh. Each model specifies its API name, resolution, `forecast_days` cutoff, and optional `patch` fields (borrowed from the default model when a model doesn't provide them, e.g. visibility for AROME).

Current NL models:

| Key | Model | Notes |
|-----|-------|-------|
| `soar_knmi` | KNMI HARMONIE | HARMONIE AROME days 0–2, then blends into ECMWF IFS |
| `soar_ecmwf` | ECMWF IFS | Most reliable for days 4–7 |
| `soar_icon` | DWD ICON D2 | ICON D2 for 72 h, then ICON EU; 3-hourly after 78 h (interpolated) |
| `soar_arome` | Météo-France AROME HD | Up to 4 days only; visibility patched in from KNMI |

Wind speed, direction and gusts are sampled at hand-picked offshore coordinates upwind of each location (offset by the model's grid resolution). Temperature, visibility and precipitation are sampled at the flying site itself.

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

### Measurements

`measurement_service.py` orchestrates fetching from multiple measurement APIs using a registry pattern. Each API has its own `meas_fetch_<api>.py` module (e.g. `meas_fetch_rws.py` for Rijkswaterstaat via ddlpy, `meas_fetch_nkv.py` for NKV). The station registry in `stations_{country}.json` maps API names to station codes. Each location in `soar_points` references a primary `station` and optionally an `alt_station` from a different API.

Measurements are standardised to: `{station_code: {name, lat, lon, wind: {timestamps, wind_min, wind_max}, heading: {timestamps, values} | None}}`.

Data is refreshed every 15 minutes, but only during the daylight window (90 min before sunrise to 90 min after sunset, derived from forecast data). The `/api/status` endpoint reports `measurement_in_daylight` so the frontend can show "Night" status instead of "Stale".

### Server-side display cache

`_display_cache` in `main.py` memoises `display()` results in a plain dict, keyed on `(country, mode, model, time_start, time_end, wings_json, weight, wind_min, wind_max, ignore_precip_vis)`. The cache is cleared per-country whenever a fresh forecast is fetched. This means confidence scoring — which calls `display()` for all models — is fast after the first request for a given settings combination.

### Multi-tenant state structure

All state is organised per-country and per-mode so that concurrent users with different selections never interfere:

```python
state = {
    "countries": {},      # {code: {name, timezone}}
    "modes": {},          # {code: display_name}
    "c": {},              # per-country: soar_points, models, stations, forecast, measurements, updating_*
    "m": {},              # per-mode: wings, ranges
    "enriched": {},       # per country:mode: {"nl:para": [enriched points]}
}
```

Pickle files are scoped by country (`forecast_{country}.pkl`, `measurements_{country}.pkl`). Background workers take a `country` parameter and only touch that country's state.

---

## How the frontend works

### Data flow

`useSoarData.js` owns all remote state. On mount it detects the initial country from the subdomain (falling back to localStorage, then `"nl"`), sets the API scope via `setApiScope(country, mode)`, and loads from `localStorage` immediately so the UI is populated before any network round-trip. It then fetches fresh data in the background. A `setInterval` poll runs every 10 seconds, checking `/api/status` and triggering a display or measurement refetch whenever the server signals a background update has just finished or data has gone stale. Measurement refreshes are gated by the backend's `measurement_in_daylight` flag to avoid pointless overnight fetches.

`dateIdx` and `ptIdx` (currently selected day and location) live inside `useSoarData` rather than in individual components. Tapping a map marker sets `ptIdx` so the user can switch to the Point tab with the right location pre-selected.

`switchConfig(country, mode)` updates the API scope via `setApiScope()`, then reloads all data (points, days, status, wings, models, ranges) for the new combination. No server-side state mutation is needed — the backend is stateless with respect to the "active" country/mode; each request carries its own scope as query parameters. All localStorage cache keys are scoped by `country:mode` so switching back to a previous selection restores cached data instantly.

`api.js` exposes `setApiScope(country, mode)` which stores the current country and mode. All API functions auto-append the relevant query parameters (`?country=nl&mode=para`) to each request. Endpoints that only need the country (e.g. `/api/status`, `/api/measurements`) omit the mode parameter, and vice versa.

### Client-side cache

All data types are cached in `localStorage`, scoped by `country:mode`:

| Data | Key pattern | TTL |
|------|-------------|-----|
| Display forecast (Gantt, hours, certainty) | `soar_display_v3:<country:mode>:<settings hash>` | 2 h |
| Raw forecast (hourly per point) | `soar_raw_v3:<country:mode>:<model>` | 2 h |
| Measurements | `soar_measurements_v3:<country:mode>` | 15 min |

The display cache key includes the full settings combination, so changing model, wings, weight or the time window triggers a fresh fetch rather than serving a stale result.

### Map tab

`MapForecast.jsx` contains three visualisations that share a single `useMemo` pass over `displayForecast`:

- **Leaflet map** with arrow-shaped polygon overlays per location, sized and coloured by flyable quality. The map auto-zooms to fit all locations with padding using `fitBounds`. Popups show flyable hour summaries, Google Maps and Spot information links. Tapping a marker selects that location for the Point tab.
- **Bar chart** (Recharts) showing stacked flyable-hour categories per day. Rain and fog badges sit in a row above the bars. Clicking a bar selects that day.
- **Gantt chart** (plain SVG) showing flyable windows and weather overlays per day. Layout constants — including the left-label column width — are computed from the container's live pixel width via `ResizeObserver`, so the chart adapts to any screen size without fixed breakpoints.

### Point tab

`PointForecast.jsx` renders Recharts line charts for wind speed and heading for the selected location and day. Measurements are overlaid as a semi-transparent band showing the min–max spread at each 10-minute interval.

Key features:
- **Site information symbols** — a row of clickable icons at the top showing dune type, hazards, regulations, etc. Tapping a symbol reveals a tooltip with detailed information. Symbols are responsive with `clamp(40px, 10vw, 56px)` sizing.
- **Spot information link** — links to an external site description page.
- **Station selector** — at locations with an alternative station, radio buttons let the user choose which station's wind measurements to overlay. Heading measurements always come from the primary station.
- **Wind range reference lines** — green dashed lines on the wind chart showing the effective min/max for each configured wing at this location.

### Settings tab

`Settings.jsx` provides:
- **Country and Mode** dropdowns (side by side) for switching between available countries and flying modes
- **Speed Units** selector (km/h, kt, m/s)
- **Forecast Model** selector (labelled with country name)
- **Custom Wind Range** toggle with manual min/max inputs
- **Wing configuration** — up to 5 wings with type selector, size input, and info tooltips
- **Total Weight** input for wind range scaling
- **Availability Window** time range
- **Data Status** panel showing forecast/measurement freshness with Night mode indicator
- **Tutorial** replay button

### Info tab

`Info.jsx` displays flyability calculation details, pulling the exact formula strings from `GET /api/ranges` so the displayed equations always match what the backend computes. Per-country data source information is loaded dynamically from `DataSources_{country}.jsx` components via `import.meta.glob` — adding a new country's data sources page requires no edits to Info.jsx.

### Tutorial

`Tutorial.jsx` runs a spotlight tour on first visit (keyed on `localStorage` flag `soaralarm_welcomed`). It can be replayed from the Settings tab. The tutorial includes introductory messages for each tab before stepping through individual elements. The spotlight tracks the highlighted element via a `requestAnimationFrame` loop so it follows if the page scrolls. Tooltip height is measured after each render with `useLayoutEffect` and used to position the card on the correct side of the spotlight without guessing. When a step requires a different tab, the tutorial switches tabs and retries the element query until it appears in the DOM. The card carries `translate="no"` to stop browser auto-translate from corrupting React's DOM reconciliation.

---

## Deployment — single backend, subdomain-per-country

Each country is served on its own subdomain: `nl.soaralarm.eu`, `dk.soaralarm.eu`, etc. The frontend detects the country from the subdomain and includes it as a query parameter in every API request. A **single backend instance** serves all countries and modes simultaneously — no per-country processes needed.

### DNS

At your DNS provider (e.g. Cloudflare), create:

| Type | Name | Value | Notes |
|------|------|-------|-------|
| A | `soaralarm.eu` | `<server IP>` | Bare domain (optional landing/redirect) |
| A | `*.soaralarm.eu` | `<server IP>` | Wildcard — catches all subdomains |
| A | `soaralarm.nl` | `<server IP>` | Legacy domain redirect |

If using Cloudflare with proxying enabled, the wildcard works automatically. Otherwise, add individual A records for each country subdomain.

### Nginx

```nginx
# ── Redirect legacy soaralarm.nl → nl.soaralarm.eu ──────────────────────
server {
    listen 80;
    listen 443 ssl;
    server_name soaralarm.nl www.soaralarm.nl;

    ssl_certificate     /etc/letsencrypt/live/soaralarm.nl/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/soaralarm.nl/privkey.pem;

    return 301 https://nl.soaralarm.eu$request_uri;
}

# ── Bare domain redirect → nl (or a landing page) ───────────────────────
server {
    listen 80;
    listen 443 ssl;
    server_name soaralarm.eu www.soaralarm.eu;

    ssl_certificate     /etc/letsencrypt/live/soaralarm.eu/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/soaralarm.eu/privkey.pem;

    return 301 https://nl.soaralarm.eu$request_uri;
}

# ── All country subdomains → single backend ──────────────────────────────
server {
    listen 80;
    listen 443 ssl;
    server_name ~^(?<country>[a-z]{2})\.soaralarm\.eu$;

    ssl_certificate     /etc/letsencrypt/live/soaralarm.eu/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/soaralarm.eu/privkey.pem;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
    }
    location / {
        root /var/www/soaralarm/frontend/dist;
        try_files $uri $uri/ /index.html;
    }
}
```

All country subdomains share the same backend instance on port 8000 and the same built frontend (`dist/`). The frontend reads the subdomain to determine the country and sends it as a `?country=` query parameter with every API call. The backend never needs to know which subdomain was used.

### Backend — single instance

```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000
```

On startup the backend loads all countries and modes from the config files. No environment variables needed — adding a new country is just adding config files and restarting.

### Systemd service (optional)

Create `/etc/systemd/system/soaralarm.service`:

```ini
[Unit]
Description=Soaralarm backend
After=network.target

[Service]
User=www-data
WorkingDirectory=/var/www/soaralarm/backend
ExecStart=/var/www/soaralarm/backend/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable with `systemctl enable --now soaralarm`.

### SSL with Let's Encrypt

For wildcard certs (covers `*.soaralarm.eu`), use DNS-01 challenge:

```bash
certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  -d soaralarm.eu -d '*.soaralarm.eu'
```

This single cert covers the bare domain and all subdomains. For `soaralarm.nl`, obtain a separate cert or add it to the same command.

---

## API reference

All endpoints that need country or mode context receive them as **query parameters** — there is no server-side "active" selection.

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| GET | `/api/status` | `?country=` | Forecast/measurement ages, stale flags, updating flags, daylight flag |
| GET | `/api/points` | `?country=&mode=` | All soaring point definitions (enriched with computed ranges) |
| GET | `/api/wings` | `?mode=` | Wing type catalogue |
| GET | `/api/models` | `?country=` | Forecast model definitions |
| GET | `/api/ranges` | `?mode=` | Range calibration config (formula strings, steepness, wings) |
| GET | `/api/countries` | — | All available countries |
| GET | `/api/modes` | — | All available modes |
| GET | `/api/days` | — | Day labels (Yesterday through +6 days) |
| GET | `/api/forecast/display` | `?country=&mode=` | Per-day Gantt, hours, certainty — accepts settings params below |
| GET | `/api/forecast/raw` | `?country=` | Full hourly data per point, for the Point tab charts |
| GET | `/api/measurements` | `?country=` | Wind speed and direction per station |
| POST | `/api/forecast/refresh` | `?country=` | Kick off a background forecast refresh |
| POST | `/api/measurements/refresh` | `?country=` | Kick off a background measurement refresh |

**`/api/forecast/display` additional query parameters**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `model` | first in config | Which model to use for display |
| `time_start` | `00:00` | Start of pilot availability window |
| `time_end` | `23:59` | End of pilot availability window |
| `wings` | — | JSON array of `{key, size}` objects |
| `weight` | `70.0` | Total pilot weight in flight (kg) |
| `wind_min` | — | Custom minimum wind (km/h); enables custom mode |
| `wind_max` | — | Custom maximum gust (km/h); enables custom mode |

---

## Credits

Built with the help of awesome Dutch pilots, as well as [Claude](https://www.anthropic.com/claude) (Anthropic), which helped extensively in the design of the web service architecture and frontend development.

Also made possible by [Open-Meteo](https://open-meteo.com/) and the [ddlpy](https://github.com/Deltares/ddlpy) library for RWS data access.
