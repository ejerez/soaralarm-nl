const BASE = '/api'
const TRANSIENT = new Set([502, 503, 504])
const RETRY_DELAYS = [1000, 2000, 4000]  // 3 attempts, ~7 s total

// ── Country/mode scope ──────────────────────────────────────────────────────
// Set once on init (from subdomain or localStorage) and updated when the user
// switches country/mode.  Auto-appended as query params to every request.
let _scope = { country: '', mode: '' }

export function setApiScope(country, mode) {
  _scope = { country: country || '', mode: mode || '' }
}

export function getApiScope() {
  return { ..._scope }
}

function _appendScope(path, { country = true, mode = true } = {}) {
  const url = new URL(path, 'http://x')  // dummy base for relative paths
  if (country && _scope.country) url.searchParams.set('country', _scope.country)
  if (mode && _scope.mode)       url.searchParams.set('mode', _scope.mode)
  return url.pathname + url.search
}

async function get(path, attempt = 0) {
  let res
  try {
    res = await fetch(BASE + path)
  } catch (e) {
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

async function post(path, body) {
  const opts = { method: 'POST' }
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' }
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(BASE + path, opts)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`)
  return res.json()
}

export const api = {
  // country + mode
  status:          ()  => get(_appendScope('/status', { mode: false })),
  points:          ()  => get(_appendScope('/points')),
  wings:           ()  => get(_appendScope('/wings', { country: false })),
  ranges:          ()  => get(_appendScope('/ranges', { country: false })),
  models:          ()  => get(_appendScope('/models', { mode: false })),
  measurements:    ()  => get(_appendScope('/measurements', { mode: false })),

  // no scope needed
  days:            ()  => get('/days'),
  countries:       ()  => get('/countries'),
  modes:           ()  => get('/modes'),
  whatsnew:        ()  => get('/whatsnew'),

  displayForecast: (model, ts, te, selectedWings, weight, windMin, windMax) => {
    const params = new URLSearchParams({
      model,
      time_start: ts,
      time_end:   te,
      weight:     weight ?? 75,
    })
    if (_scope.country) params.set('country', _scope.country)
    if (_scope.mode)    params.set('mode', _scope.mode)
    if (selectedWings?.length) {
      params.set('wings', JSON.stringify(selectedWings))
    }
    if (windMin != null) params.set('wind_min', windMin)
    if (windMax != null) params.set('wind_max', windMax)
    return get(`/forecast/display?${params}`)
  },

  rawForecast: (model) => get(_appendScope(`/forecast/raw?model=${model}`, { mode: false })),

  refreshForecast: () => post(_appendScope('/forecast/refresh', { mode: false })),
  refreshMeasure:  () => post(_appendScope('/measurements/refresh', { mode: false })),
}
