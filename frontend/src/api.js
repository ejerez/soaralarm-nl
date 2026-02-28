const BASE = '/api'

async function get(path) {
  const res = await fetch(BASE + path)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`)
  return res.json()
}

async function post(path) {
  const res = await fetch(BASE + path, { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`)
  return res.json()
}

export const api = {
  status:           ()           => get('/status'),
  points:           ()           => get('/points'),
  days:             ()           => get('/days'),
  displayForecast:  (model, ts, te) =>
    get(`/forecast/display?model=${model}&time_start=${ts}&time_end=${te}`),
  rawForecast:      (model)      => get(`/forecast/raw?model=${model}`),
  measurements:     ()           => get('/measurements'),
  refreshForecast:  ()           => post('/forecast/refresh'),
  refreshMeasure:   ()           => post('/measurements/refresh'),
}
