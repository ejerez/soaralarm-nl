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
│   ├── measurement_service.py   # Measurement fetching orchestrator (delegates to meas_fetch_{country}.py)
│   ├── meas_fetch_nl.py         # NL measurements: RWS wind (ddlpy) + KNMI radar tiles + nowcast
│   ├── config/
│   │   ├── countries.json       # Available countries (code → {name, timezone})
│   │   ├── modes.json           # Available flying modes (code → display name)
│   │   ├── soar_points_nl.json  # NL locations (coords, heading, slope, info symbols, links)
│   │   ├── models_nl.json       # NL forecast model definitions (resolution, patches, forecast_days)
│   │   ├── wings_para.json      # Paragliding wing catalogue (display names, default sizes, tooltips)
│   │   ├── ranges_para.json     # Paragliding range calibration (formula strings, steepness, wings)
│   │   ├── stations_nl.json     # NL measurement station registry (API → station codes)
│   │   └── whatsnew.json        # What's new entries shown in the Info tab
│   ├── .cache/                  # Pickle cache for forecast, measurement, and radar tile data (per country)
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── App.jsx              # Tab shell, date bar, loading states
    │   ├── api.js               # Fetch wrapper with retry logic, auto-appends country/mode scope
    │   ├── forecastShared.js    # Shared design tokens (T, C), helpers (fitTextSize, certLabel, parseWingSetKey, clampGanttToWindow)
    │   ├── fs.js                # Font-size scaling helpers (fs, fsc) — all font sizes flow through these
    │   ├── locationSort.js      # Shared location ranking logic (compareLocations, findBestLocationIndex)
    │   ├── hooks/
    │   │   └── useSoarData.js   # All data fetching, polling, caching, country/mode switching
    │   └── components/
    │       ├── MapForecast.jsx     # Leaflet map, flyable-hours bar chart, gantt chart wrapper, confidence
    │       ├── GanttChart.jsx      # SVG gantt chart with flyable windows, weather overlays, tooltips
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
5. Create `meas_fetch_dk.py` — country-level measurement module exposing `fetch(stations_config, soar_points)`
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

#### Wind category classification

The `display()` method delegates hourly classification to focused helpers:

| Helper | Purpose |
|--------|---------|
| `Cat` class | Constants for all wind categories (`GOOD`, `CROSS`, `GOOD_GUSTY`, `CROSS_GUSTY`, `NO`) plus `FLYABLE` set, `GUSTY_THRESHOLD`, and helpers like `_empty_quality_dict()` and `quality_index()`. Single source of truth for category names — prevents mismatches like the `"gusty"` vs `"good_gusty"` bug. |
| `_classify_wind_direction(wind_dir, heading, head_range)` | Returns one of `Cat.GOOD`, `Cat.CROSS`, or `Cat.NO` based on the relative angle between wind direction and slope heading. |
| `_pizza_slice(cat, head_range, rel_angle)` | Returns the wind pizza index (0=left-cross, 1=good, 2=right-cross) for the pizza chart overlays on the map. |
| `_apply_gustiness(cat, wind_speed, wind_gusts)` | Appends `_gusty` suffix when gusts exceed wind speed by > 20 km/h. |
| `_accumulate_quality(cat, ...)` | Updates all quality accumulators for one hour: `wind_quality` array, `wind_pizza`, `wing_quality_counts`, `individual_wing_hours`. |

#### Segment trackers

Gantt and weather segment tracking is handled by two small classes:

| Class | Purpose |
|-------|---------|
| `_GanttTracker` | Tracks consecutive flyable segments with the same category+wing set. Emits gantt entries with `{type, start, end, wings}`. |
| `_WeatherTracker` | Tracks consecutive fog or rain segments. Emits entries with `{type, start, end}`. |

Both classes follow the same `update()` → `flush()` pattern: `update()` is called per hour and detects segment boundaries; `flush()` is called once after the loop to close the final segment.

#### Output data shape

Each day×point entry in the display output contains:

```python
{
    "wind_pizza":          [left_cross, good, right_cross],
    "good_hours":          int,    # good heading, no gustiness
    "cross_hours":         int,    # crosswind heading, no gustiness
    "gusty_hours":         int,    # good heading + gusty
    "cross_gusty_hours":   int,    # crosswind heading + gusty
    "wing_set_hours":      {"wing_key:size": {"good": N, "cross": N, "good_gusty": N, "cross_gusty": N}},
    "gantt":               [{type, start, end, wings}],
    "fog_gantt":           [{type, start, end}],
    "rain_gantt":          [{type, start, end}],
    "has_fog":             bool,
    "has_rain":            bool,
    "wind_ranges":         [{key, size, range: [min, max]}],
    "best_wing":           {key, size} | null,
}
```

The `wing_set_hours` dict uses the same `Cat` constants as keys (`good`, `cross`, `good_gusty`, `cross_gusty`). The frontend maps `good_gusty` to its display name "Gusty" via the `QUALITIES` array.

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

`measurement_service.py` orchestrates fetching via a country-based pattern. Each country has one `meas_fetch_{country}.py` module that handles all of that country's measurement sources. The module must expose a `fetch(stations_config, soar_points)` function. The station registry in `stations_{country}.json` maps API names to station codes.

The NL module (`meas_fetch_nl.py`) returns:
```python
{
    "rws":  {station_code: {name, lat, lon, wind: {timestamps, wind_min, wind_max}, heading: {timestamps, values} | None}},
    "rain_tiles": [{image, bounds, time, timestamp}, ...] | None,   # up to 4 tiles, cached at 15-min intervals
    "short_term_precipitation": [{timestamps, values} | None, ...], # per soar_point, 2 h at 5-min resolution
}
```

Each location in `soar_points` references a primary `station` and optionally an `alt_station`.

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

Settings changes (model, wings, weight, time window, wind range) trigger an immediate `fetchDisplay()` via a `useEffect` dependency array — there is no need to wait for the next poll cycle. The `fetchDisplay()` function is stable (never recreated) and reads the latest settings from a ref, so concurrent settings changes are coalesced correctly: if a fetch is already in progress, the pending flag ensures a second fetch runs immediately after the first completes.

`dateIdx` and `ptIdx` (currently selected day and location) live inside `useSoarData` rather than in individual components. Tapping a map marker sets `ptIdx` so the user can switch to the Point tab with the right location pre-selected.

`switchConfig(country, mode)` updates the API scope via `setApiScope()`, then reloads all data (points, days, status, wings, models, ranges) for the new combination. No server-side state mutation is needed — the backend is stateless with respect to the "active" country/mode; each request carries its own scope as query parameters. All localStorage cache keys are scoped by `country:mode` so switching back to a previous selection restores cached data instantly.

`api.js` exposes `setApiScope(country, mode)` which stores the current country and mode. All API functions auto-append the relevant query parameters (`?country=nl&mode=para`) to each request. Endpoints that only need the country (e.g. `/api/status`, `/api/measurements`) omit the mode parameter, and vice versa.

### Client-side cache

All data types are cached in `localStorage`, scoped by `country:mode`:

| Data | Key pattern | TTL |
|------|-------------|-----|
| Display forecast (Gantt, hours, certainty) | `soar_display_v6:<country:mode>:<settings hash>` | 2 h |
| Raw forecast (hourly per point) | `soar_raw_v2:<country:mode>:<model>` | 2 h |
| Measurements | `soar_measurements_v3:<country:mode>` | 15 min |

The display cache key includes the full settings combination, so changing model, wings, weight or the time window triggers a fresh fetch rather than serving a stale result. The version number (`v6`) is bumped whenever the API response shape changes (e.g. the `gusty` → `good_gusty` key rename in `wing_set_hours`), ensuring existing users get fresh data immediately after deploy. On cache write failure (localStorage full), all display cache entries are pruned via a prefix match on `soar_display_`.

### Shared utilities — `forecastShared.js`

Design tokens and helper functions shared between `MapForecast.jsx`, `GanttChart.jsx`, and `App.jsx`:

| Export | Purpose |
|--------|---------|
| `T` | Design tokens (bg, surface, card, border colors, text levels, accent, font family) |
| `C` | Wind/weather colours (good, cross, gusty, crossGusty, rain, fog) |
| `fitTextSize(text, maxW, maxS)` | Measures text with canvas context, returns largest font size that fits |
| `certLabel(agree, total)` | Returns `{label, color}` for confidence stars (★★★★ → ★) |
| `shortenDay(day)` | Maps full day names to abbreviations (Yesterday → Yest., Monday → Mon.) |
| `parseWingSetKey(wsKey)` | Parses `"key:size,key:size"` strings into `[{key, size}]` arrays |
| `clampGanttToWindow(g, start, end)` | Clamps a gantt entry to the effective time window, or returns `null` if outside |
| `wingSetFullLabel(wsKey, wingModelName)` | Builds display labels like `"Scraper 16m² - Scraper 20m²"` |
| `wrapTextLines(ctx, words, maxW)` | Word-wraps text into lines that fit within a given pixel width |

### Map tab

`MapForecast.jsx` renders three visualisations:

- **Leaflet map** with arrow-shaped polygon overlays per location, sized and coloured by flyable quality. The map auto-zooms to fit all locations with padding using `fitBounds`. Popups show flyable hour summaries, Google Maps and Spot information links. Tapping a marker selects that location for the Point tab.
- **Bar chart** (Recharts) showing stacked flyable-hour categories per day. Rain and fog badges sit in a row above the bars. Clicking a bar selects that day. In wing-set mode (multiple wing configurations), bars are split by wing set with size labels inside each segment.
- **Gantt chart** rendered by the extracted `GanttChart.jsx` component (plain SVG) showing flyable windows and weather overlays per day. Layout constants — including the left-label column width — are computed from the container's live pixel width via `ResizeObserver`, so the chart adapts to any screen size without fixed breakpoints.

Data for these visualisations is computed by two focused `useMemo` hooks:

| Memo | Outputs | Description |
|------|---------|-------------|
| `useBarAndGanttData` | `barData`, `certByDay`, `weatherByDay`, `bestWingByDay`, `ganttRows`, `weatherRows` | Date-mode: best location per day, bar chart data, gantt segments for the selected date range |
| `useLocationsData` | `locGanttRows`, `locWeatherRows`, `locCertByDay`, `locDays`, `locPtMap`, `locBestWingByDay` | Location-mode: top 5 locations for the selected day, ranked by flyability |

A third memo (`flatBarData`) flattens `wing_set_hours` into per-wing-set Recharts bar data keys (`good__wingKey`, `cross__wingKey`, etc.), mapping the backend's `good_gusty` key to the frontend's `gusty` display name.

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
| GET | `/api/measurements` | `?country=` | Wind speed and direction per station, plus radar tiles and nowcast |
| GET | `/api/whatsnew` | — | What's new entries from `whatsnew.json` |
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

Built with the help of awesome Dutch pilots, as well as [Claude](https://www.anthropic.com/claude) (Anthropic) and [Mistral Vibe](https://mistral.ai/) (Mistral AI), which helped extensively in the design of the web service architecture and frontend development.

Also made possible by [Open-Meteo](https://open-meteo.com/) and the [ddlpy](https://github.com/Deltares/ddlpy) library for RWS data access.
