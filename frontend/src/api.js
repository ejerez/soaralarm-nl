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
  status:          ()                               => get('/status'),
  points:          ()                               => get('/points'),
  days:            ()                               => get('/days'),
  wings:           ()                               => get('/wings'),
  displayForecast: (model, ts, te, selectedWings)   => {
    const params = new URLSearchParams({
      model,
      time_start: ts,
      time_end:   te,
    })
    // Encode the wings array as a JSON string; backend will decode it
    if (selectedWings?.length) {
      params.set('wings', JSON.stringify(selectedWings))
    }
    return get(`/forecast/display?${params}`)
  },
  rawForecast:     (model)                          => get(`/forecast/raw?model=${model}`),
  measurements:    ()                               => get('/measurements'),
  refreshForecast: ()                               => post('/forecast/refresh'),
  refreshMeasure:  ()                               => post('/measurements/refresh'),
}