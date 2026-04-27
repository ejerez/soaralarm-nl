import { _cfg } from './_cfg.js'

const BASE = '/api'
const TRANSIENT = new Set([502, 503, 504])
const RETRY_DELAYS = [1000, 2000, 4000]

let _scope = { country: '', mode: '' }

export function setApiScope(country, mode) {
  _scope = { country: country || '', mode: mode || '' }
}

export function getApiScope() {
  return { ..._scope }
}

function _localTokenParam(url) {
  const token = _cfg.getToken(_scope.country)
  if (token) url.searchParams.set('local_token', token)
}

function _appendScope(path, { country = true, mode = true } = {}) {
  const url = new URL(path, 'http://x')
  if (country && _scope.country) url.searchParams.set('country', _scope.country)
  if (mode && _scope.mode)       url.searchParams.set('mode', _scope.mode)
  _localTokenParam(url)
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
  status:          ()  => get(_appendScope('/status', { mode: false })),
  points:          ()  => get(_appendScope('/points')),
  wings:           ()  => get(_appendScope('/wings', { country: false })),
  ranges:          ()  => get(_appendScope('/ranges', { country: false })),
  models:          ()  => get(_appendScope('/models', { mode: false })),
  measurements:    ()  => get(_appendScope('/measurements', { mode: false })),

  days:            ()  => get('/days'),
  countries:       ()  => get('/countries'),
  modes:           ()  => get('/modes'),
  whatsnew:        ()  => get('/whatsnew'),

  localModeQuestion: (country) => get(`/local_mode_question?country=${country}`),
  localModeVerify:   (country, answer) => post(`/local_mode_verify?country=${country}`, { answer }),
  localModeMigrate:  (country) => post(`/local_mode_migrate?country=${country}`),

  displayForecast: (model, ts, te, selectedWings, weight, windMin, windMax) => {
    const params = new URLSearchParams({
      model,
      time_start: ts,
      time_end:   te,
      weight:     weight ?? 75,
    })
    if (_scope.country) params.set('country', _scope.country)
    if (_scope.mode)    params.set('mode', _scope.mode)
    const token = _cfg.getToken(_scope.country)
    if (token) params.set('local_token', token)
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
