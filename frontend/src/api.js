const BASE = '/api'
const TRANSIENT = new Set([502, 503, 504])
const RETRY_DELAYS = [1000, 2000, 4000]  // 3 attempts, ~7 s total

async function get(path, attempt = 0) {
  let res
  try {
    res = await fetch(BASE + path)
  } catch (e) {
    // Network error (server not reachable yet)
    if (attempt < RETRY_DELAYS.length) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]))
      return get(path, attempt + 1)
    }
    throw new Error(`Network error: ${path}`)
  }
  if (TRANSIENT.has(res.status) && attempt < RETRY_DELAYS.length) {
    await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]))
    return get(path, attempt + 1)
  }
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
  models:          ()                               => get('/models'),
  displayForecast: (model, ts, te, selectedWings, weight, windMin, windMax) => {
    const params = new URLSearchParams({
      model,
      time_start: ts,
      time_end:   te,
      weight:     weight ?? 75,
    })
    // Encode the wings array as a JSON string; backend will decode it
    if (selectedWings?.length) {
      params.set('wings', JSON.stringify(selectedWings))
    }
    // Custom wind range mode — overrides wing/weight-based calculation on backend
    if (windMin != null) params.set('wind_min', windMin)
    if (windMax != null) params.set('wind_max', windMax)
    return get(`/forecast/display?${params}`)
  },
  rawForecast:     (model)                          => get(`/forecast/raw?model=${model}`),
  measurements:    ()                               => get('/measurements'),
  refreshForecast: ()                               => post('/forecast/refresh'),
  refreshMeasure:  ()                               => post('/measurements/refresh'),
}