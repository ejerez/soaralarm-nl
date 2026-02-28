# Soaralarm NL — FastAPI + React

A soaring/paragliding wind forecast app for the Dutch coast, converted from Streamlit to a proper web architecture.

```
soaralarm/
├── backend/
│   ├── main.py                # FastAPI app & all API routes
│   ├── forecast_service.py    # Open-Meteo fetching & processing (no Streamlit)
│   ├── measurement_service.py # RWS ddlpy wind measurements (no Streamlit)
│   ├── soar_points.json       # Soaring point definitions
│   └── requirements.txt
└── frontend/
    ├── index.html
    ├── vite.config.js
    ├── package.json
    └── src/
        ├── main.jsx
        ├── App.jsx              # Tab shell, status badges, date picker
        ├── api.js               # Thin fetch wrapper for all endpoints
        ├── hooks/
        │   └── useSoarData.js   # All data fetching, polling, caching
        └── components/
            ├── MapForecast.jsx  # Leaflet map + flyable-hours bar + Gantt
            ├── PointForecast.jsx# Wind speed/dir/temp/precip charts
            └── Settings.jsx     # Model, time-window, data status
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
You can then serve `dist/` with any static file server, or have FastAPI serve it:

```python
# Add to main.py to serve the built frontend
from fastapi.staticfiles import StaticFiles
app.mount("/", StaticFiles(directory="../frontend/dist", html=True), name="static")
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Forecast/measurement ages & update flags |
| GET | `/api/points` | All soaring point definitions |
| GET | `/api/days` | Day label list (Yesterday … +6 days) |
| GET | `/api/forecast/display?model=&time_start=&time_end=` | Per-day gantt, wind_pizza, hours |
| GET | `/api/forecast/raw?model=` | Full hourly data for point-detail charts |
| GET | `/api/measurements` | Wind speed + direction per station |
| POST | `/api/forecast/refresh` | Trigger background forecast update |
| POST | `/api/measurements/refresh` | Trigger background measurement update |

---

## Key Architecture Changes vs. Streamlit

| Streamlit | FastAPI + React |
|-----------|-----------------|
| `st.session_state` for all state | In-memory `state` dict in `main.py`; React state in hooks |
| `asyncio.run(make_forecast())` blocking the UI | FastAPI `BackgroundTasks` — non-blocking, polled by frontend |
| `st.spinner` / `st.rerun` | Status badges + auto-polling every 10 s via `useSoarData` hook |
| `pickle.load` on every Streamlit re-render | Loaded once on startup; persisted after each refresh |
| `folium` maps in Python | `react-leaflet` rendered in browser |
| `plotly` charts in Python | `recharts` rendered in browser |
| Cookies for user settings | `localStorage` (no server round-trip needed) |
| `ddlpy` DataFrames passed around | Serialised to JSON timestamps+values arrays by `MeasurementService` |

---

## Adding More Points

Edit `backend/soar_points.json`. The schema for each point:

```json
{
  "lat": 52.123,
  "lon": 4.456,
  "offshore_lat": 52.120,
  "offshore_lon": 4.400,
  "name": "My Spot",
  "station": "ijmuiden.havenhoofd.zuid",
  "heading": 270,
  "head_range": [-45, 45],
  "wind_range": [20, 50],
  "preset": true
}
```

Restart the backend after editing.
