import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api.js'

const POLL_MS = 10_000   // poll status every 10 s

// ── Display forecast cache (localStorage) ────────────────────────────────
function displayCacheKey(model, timeStart, timeEnd, selectedWings, weight, customWind, windMin, windMax) {
  return 'soar_display_v1:' + JSON.stringify({ model, timeStart, timeEnd, selectedWings, weight, customWind, windMin, windMax })
}
function loadDisplayCache(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { display, certainty, savedAt } = JSON.parse(raw)
    if (Date.now() - savedAt > 2 * 60 * 60 * 1000) return null  // stale after 2 h
    return { display, certainty }
  } catch { return null }
}
function saveDisplayCache(key, display, certainty) {
  try {
    localStorage.setItem(key, JSON.stringify({ display, certainty, savedAt: Date.now() }))
  } catch {
    try {
      Object.keys(localStorage).filter(k => k.startsWith('soar_display_v1:')).forEach(k => localStorage.removeItem(k))
      localStorage.setItem(key, JSON.stringify({ display, certainty, savedAt: Date.now() }))
    } catch {}
  }
}

function loadSelectedWings() {
  try {
    const raw = localStorage.getItem('selectedWings')
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

// Read all settings from localStorage once — single consistent snapshot
function readSettingsFromStorage() {
  return {
    model:         localStorage.getItem('model')        || 'soar_knmi',
    timeStart:     localStorage.getItem('timeStart')    || '00:00',
    timeEnd:       localStorage.getItem('timeEnd')      || '23:59',
    selectedWings: loadSelectedWings(),
    weight:        parseFloat(localStorage.getItem('weight')  ?? '75'),
    customWind:    localStorage.getItem('customWind') === 'true',
    windMin:       parseFloat(localStorage.getItem('windMin') ?? '15'),
    windMax:       parseFloat(localStorage.getItem('windMax') ?? '60'),
  }
}

// Returns true if now is within 90 minutes of sunrise/sunset for today's first point
function isInDaylightWindow(rawForecast) {
  try {
    const todayFc = rawForecast?.[1]?.[0]
    if (!todayFc?.sunrise || !todayFc?.sunset) return true
    const now     = Date.now()
    const sunrise = new Date(todayFc.sunrise).getTime()
    const sunset  = new Date(todayFc.sunset).getTime()
    const MARGIN  = 90 * 60 * 1000
    return now >= sunrise - MARGIN && now <= sunset + MARGIN
  } catch { return true }
}

export function useSoarData() {
  // ── Read initial settings + cache in a single pass ───────────────────────
  const initSettings = readSettingsFromStorage()
  const initCacheKey = displayCacheKey(
    initSettings.model, initSettings.timeStart, initSettings.timeEnd,
    initSettings.selectedWings, initSettings.weight,
    initSettings.customWind, initSettings.windMin, initSettings.windMax,
  )
  const initCache = loadDisplayCache(initCacheKey)

  const [status, setStatus]           = useState(null)
  const [points, setPoints]           = useState([])
  const [days, setDays]               = useState([])
  const [wings, setWings]             = useState({})
  const [displayForecast, setDisplay] = useState(initCache?.display ?? null)
  const [certainty, setCertainty]     = useState(initCache?.certainty ?? null)
  const [rawForecast, setRaw]         = useState(null)
  const [measurements, setMeasure]    = useState(null)
  const [loading, setLoading]         = useState(!initCache)   // skip spinner on cache hit
  const [error, setError]             = useState(null)

  // User settings (persisted in localStorage)
  const [model, setModel]               = useState(initSettings.model)
  const [timeStart, setTimeStart]       = useState(initSettings.timeStart)
  const [timeEnd, setTimeEnd]           = useState(initSettings.timeEnd)
  const [selectedWings, setSelectedWings] = useState(initSettings.selectedWings)
  const [weight, setWeight]             = useState(initSettings.weight)
  const [customWind, setCustomWind]     = useState(initSettings.customWind)
  const [windMin, setWindMin]           = useState(initSettings.windMin)
  const [windMax, setWindMax]           = useState(initSettings.windMax)
  const [dateIdx, setDateIdx]           = useState(1)

  // ── Refs ──────────────────────────────────────────────────────────────────
  // Mirror of current settings so fetchDisplay() can stay stable (no deps)
  const settingsRef = useRef(initSettings)

  // If fetchDisplay() is called while one is in-flight, pendingFetch is set
  // so the finally block re-runs with the latest settings automatically.
  const isFetchingDisplay = useRef(false)
  const pendingFetch      = useRef(false)

  const prevMeasAgeRef     = useRef(null)
  const prevForecastAgeRef = useRef(null)
  const rawForecastRef     = useRef(null)   // stable ref so poll never recreates the interval

  // ── Keep refs in sync with state ─────────────────────────────────────────
  useEffect(() => {
    settingsRef.current = { model, timeStart, timeEnd, selectedWings, weight, customWind, windMin, windMax }
  }, [model, timeStart, timeEnd, selectedWings, weight, customWind, windMin, windMax])

  useEffect(() => { rawForecastRef.current = rawForecast }, [rawForecast])

  // ── Save settings to localStorage ────────────────────────────────────────
  useEffect(() => { localStorage.setItem('model',         model) },        [model])
  useEffect(() => { localStorage.setItem('timeStart',     timeStart) },    [timeStart])
  useEffect(() => { localStorage.setItem('timeEnd',       timeEnd) },      [timeEnd])
  useEffect(() => { localStorage.setItem('selectedWings', JSON.stringify(selectedWings)) }, [selectedWings])
  useEffect(() => { localStorage.setItem('weight',        weight) },       [weight])
  useEffect(() => { localStorage.setItem('customWind',    customWind) },   [customWind])
  useEffect(() => { localStorage.setItem('windMin',       windMin) },      [windMin])
  useEffect(() => { localStorage.setItem('windMax',       windMax) },      [windMax])

  // ── Fetch display forecast ────────────────────────────────────────────────
  // Stable (no deps) — reads current settings from settingsRef so it never
  // needs to be recreated when settings change, which keeps the poll interval
  // alive and avoids the 10 s gap a teardown/recreate would introduce.
  const fetchDisplay = useCallback(async () => {
    if (isFetchingDisplay.current) {
      pendingFetch.current = true   // re-fetch with latest settings once this one lands
      return
    }
    isFetchingDisplay.current = true
    pendingFetch.current = false
    try {
      const { model, timeStart, timeEnd, selectedWings, weight, customWind, windMin, windMax } = settingsRef.current
      const disp = await api.displayForecast(
        model, timeStart, timeEnd, selectedWings, weight,
        customWind ? windMin : undefined,
        customWind ? windMax : undefined,
      )
      if (disp.display) {
        setDisplay(disp.display)
        const key = displayCacheKey(model, timeStart, timeEnd, selectedWings, weight, customWind, windMin, windMax)
        saveDisplayCache(key, disp.display, disp.certainty)
      }
      if (disp.certainty) setCertainty(disp.certainty)

      // Raw forecast + measurements in the background — MapForecast already
      // rendered from displayForecast above, these feed PointForecast.
      const [raw, meas] = await Promise.all([
        api.rawForecast(model),
        api.measurements(),
      ])
      if (raw.forecast) setRaw(raw.forecast)
      setMeasure(meas)
    } catch (e) {
      console.error('fetchDisplay', e)
    } finally {
      isFetchingDisplay.current = false
      // Settings changed while we were in-flight → fetch again with latest values
      if (pendingFetch.current) {
        pendingFetch.current = false
        fetchDisplay()
      }
    }
  }, [])  // stable — never recreated

  // ── Re-fetch immediately when settings change (don't wait for poll) ───────
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    fetchDisplay()
  }, [model, timeStart, timeEnd, selectedWings, weight, customWind, windMin, windMax, fetchDisplay])

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      // Cache miss → fetch display immediately; cache hit → wait until we
      // confirm the server is up (below), then fetch fresh in background.
      if (!initCache) fetchDisplay()

      const MAX_ATTEMPTS = 5
      const DELAYS = [1000, 2000, 3000, 5000, 8000]
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          const [pts, d, st, wgs] = await Promise.all([
            api.points(), api.days(), api.status(), api.wings()
          ])
          setPoints(pts)
          setDays(d.days)
          setStatus(st)
          setWings(wgs)

          const stored = loadSelectedWings()
          const firstKey = Object.keys(wgs)[0]
          if (stored.length === 0 && firstKey) {
            setSelectedWings([{ key: firstKey, size: wgs[firstKey].default_size }])
          }

          // Fire-and-forget background refresh jobs
          if (st.forecast_stale && !st.updating_forecast) api.refreshForecast()
          if (st.measurement_stale && !st.updating_measurements) api.refreshMeasure()

          // Cache hit: now that we know the server is up, refresh in the background
          if (initCache && st.forecast_available) fetchDisplay()

          setLoading(false)
          return
        } catch (e) {
          if (attempt < MAX_ATTEMPTS - 1) {
            await new Promise(r => setTimeout(r, DELAYS[attempt]))
          } else {
            setError(e.message)
            setLoading(false)
          }
        }
      }
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Poll status ───────────────────────────────────────────────────────────
  // fetchDisplay is stable → this interval is created once and never recreated.
  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const st = await api.status()
        setStatus(st)

        if (st.forecast_stale && !st.updating_forecast) api.refreshForecast()
        if (st.measurement_stale && !st.updating_measurements && isInDaylightWindow(rawForecastRef.current)) {
          api.refreshMeasure()
        }

        // Measurement refresh just completed → pull live data
        const prevMeasAge = prevMeasAgeRef.current
        const currMeasAge = st.measurement_age_seconds
        if (prevMeasAge != null && currMeasAge != null && currMeasAge < prevMeasAge - 30) {
          try { setMeasure(await api.measurements()) } catch (e) { console.error('meas live-update', e) }
        }
        prevMeasAgeRef.current = currMeasAge

        // Forecast refresh just completed → re-fetch display immediately
        const prevForecastAge = prevForecastAgeRef.current
        const currForecastAge = st.forecast_age_seconds
        prevForecastAgeRef.current = currForecastAge
        if (prevForecastAge != null && currForecastAge != null && currForecastAge < prevForecastAge - 30) {
          fetchDisplay()
          return
        }

        // No display data yet → try to fetch (in case init missed it)
        if (st.forecast_available && !isFetchingDisplay.current) {
          setDisplay(d => { if (!d) fetchDisplay(); return d })
        }
      } catch (e) {
        console.error('poll', e)
      }
    }, POLL_MS)

    return () => clearInterval(poll)
  }, [fetchDisplay])

  return {
    status, points, days, wings, displayForecast, certainty, rawForecast, measurements,
    loading, error,
    model, setModel,
    timeStart, setTimeStart,
    timeEnd, setTimeEnd,
    selectedWings, setSelectedWings,
    weight, setWeight,
    customWind, setCustomWind,
    windMin, setWindMin,
    windMax, setWindMax,
    dateIdx, setDateIdx,
    refreshForecast: api.refreshForecast,
    refreshMeasure:  api.refreshMeasure,
    refetchDisplay:  fetchDisplay,
  }
}