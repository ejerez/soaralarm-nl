import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api.js'

const POLL_MS        = 10_000              // poll status every 10 s
const CACHE_TTL      = 2 * 60 * 60 * 1000  // 2 h — matches server forecast TTL
const MEAS_CACHE_TTL = 15 * 60 * 1000      // 15 min — matches server measurement refresh interval

// ── Display forecast cache ────────────────────────────────────────────────
function displayCacheKey(model, timeStart, timeEnd, selectedWings, weight, customWind, windMin, windMax) {
  return 'soar_display_v1:' + JSON.stringify({ model, timeStart, timeEnd, selectedWings, weight, customWind, windMin, windMax })
}
function loadDisplayCache(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { display, certainty, savedAt } = JSON.parse(raw)
    if (Date.now() - savedAt > CACHE_TTL) return null
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

// ── Measurements cache ────────────────────────────────────────────────────
const MEAS_CACHE_KEY = 'soar_measurements_v1'
function loadMeasCache() {
  try {
    const raw = localStorage.getItem(MEAS_CACHE_KEY)
    if (!raw) return null
    const { data, savedAt } = JSON.parse(raw)
    if (Date.now() - savedAt > MEAS_CACHE_TTL) return null
    return data
  } catch { return null }
}
function saveMeasCache(data) {
  try {
    localStorage.setItem(MEAS_CACHE_KEY, JSON.stringify({ data, savedAt: Date.now() }))
  } catch {}
}

// ── Raw forecast cache ────────────────────────────────────────────────────
function rawCacheKey(model) { return 'soar_raw_v1:' + model }
function loadRawCache(model) {
  try {
    const raw = localStorage.getItem(rawCacheKey(model))
    if (!raw) return null
    const { forecast, savedAt } = JSON.parse(raw)
    if (Date.now() - savedAt > CACHE_TTL) return null
    return forecast
  } catch { return null }
}
function saveRawCache(model, forecast) {
  try {
    localStorage.setItem(rawCacheKey(model), JSON.stringify({ forecast, savedAt: Date.now() }))
  } catch {
    try {
      Object.keys(localStorage).filter(k => k.startsWith('soar_raw_v1:')).forEach(k => localStorage.removeItem(k))
      localStorage.setItem(rawCacheKey(model), JSON.stringify({ forecast, savedAt: Date.now() }))
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
  // ── Read initial settings + cache exactly once (inside useRef) ───────────
  // Computed at the top of the hook body these would re-run on every render;
  // storing in a ref means they run once on mount and never again.
  const initRef = useRef(null)
  if (!initRef.current) {
    const settings = readSettingsFromStorage()
    const cacheKey = displayCacheKey(
      settings.model, settings.timeStart, settings.timeEnd,
      settings.selectedWings, settings.weight,
      settings.customWind, settings.windMin, settings.windMax,
    )
    initRef.current = {
      settings,
      cache: loadDisplayCache(cacheKey),
      measCache: loadMeasCache(),
      rawCache: loadRawCache(settings.model),
    }
  }
  const { settings: initSettings, cache: initCache, measCache: initMeasCache, rawCache: initRawCache } = initRef.current

  const [status, setStatus]           = useState(null)
  const [points, setPoints]           = useState([])
  const [days, setDays]               = useState([])
  const [wings, setWings]             = useState({})
  const [displayForecast, setDisplay] = useState(initCache?.display   ?? null)
  const [certainty, setCertainty]     = useState(initCache?.certainty ?? null)
  const [rawForecast, setRaw]         = useState(initRawCache ?? null)   // warm from cache
  const [measurements, setMeasure]    = useState(initMeasCache ?? null)  // warm from cache
  const [loading, setLoading]         = useState(!initCache)  // skip spinner on cache hit
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
  const [ptIdx,   setPtIdx]             = useState(0)

  // ── Refs ──────────────────────────────────────────────────────────────────
  // Mirror of current settings so fetchDisplay() stays stable (no deps)
  const settingsRef = useRef(initSettings)

  // pendingFetch: if fetchDisplay() is called while in-flight, set this flag
  // so the finally block re-runs with the latest settings automatically.
  const isFetchingDisplay = useRef(false)
  const pendingFetch      = useRef(false)

  // Stable ref for displayForecast — lets the poll check it without depending on it
  const displayRef         = useRef(initCache?.display ?? null)
  const prevMeasAgeRef     = useRef(null)
  const prevForecastAgeRef = useRef(null)
  const rawForecastRef     = useRef(initRawCache ?? null)
  // Track updating flags so poll can detect the exact moment an update finishes
  const prevFcUpdatingRef  = useRef(false)
  const prevMsUpdatingRef  = useRef(false)

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
  // Stable (no deps) — reads settings from settingsRef.
  const fetchDisplay = useCallback(async () => {
    if (isFetchingDisplay.current) {
      pendingFetch.current = true
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
        displayRef.current = disp.display
        const key = displayCacheKey(model, timeStart, timeEnd, selectedWings, weight, customWind, windMin, windMax)
        saveDisplayCache(key, disp.display, disp.certainty)
      }
      if (disp.certainty) setCertainty(disp.certainty)

      // Raw forecast + measurements in background — MapForecast already rendered
      // Use allSettled so a measurements failure at night doesn't block rawForecast
      const [rawResult, measResult] = await Promise.allSettled([
        api.rawForecast(model),
        api.measurements(),
      ])
      if (rawResult.status === 'fulfilled' && rawResult.value?.forecast) {
        setRaw(rawResult.value.forecast)
        saveRawCache(model, rawResult.value.forecast)
      }
      if (measResult.status === 'fulfilled' && measResult.value) {
        setMeasure(measResult.value)
        saveMeasCache(measResult.value)
      }
    } catch (e) {
      console.error('fetchDisplay', e)
    } finally {
      isFetchingDisplay.current = false
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

          // Invalidate display cache if the point count has changed (e.g. new locations added)
          const cachedPointCount = displayRef.current?.[0]?.length ?? 0
          if (cachedPointCount > 0 && cachedPointCount !== pts.length) {
            setDisplay(null)
            displayRef.current = null
            const s = settingsRef.current
            try { localStorage.removeItem(displayCacheKey(s.model, s.timeStart, s.timeEnd, s.selectedWings, s.weight, s.customWind, s.windMin, s.windMax)) } catch {}
          }

          const stored = loadSelectedWings()
          const firstKey = Object.keys(wgs)[0]
          if (stored.length === 0 && firstKey) {
            setSelectedWings([{ key: firstKey, size: wgs[firstKey].default_size }])
          }

          if (st.forecast_stale && !st.updating_forecast) api.refreshForecast()
          if (st.measurement_stale && !st.updating_measurements && isInDaylightWindow(rawForecastRef.current)) api.refreshMeasure()

          // Seed the updating refs so poll transition detection works from tick 1
          prevFcUpdatingRef.current = st.updating_forecast
          prevMsUpdatingRef.current = st.updating_measurements

          // Only fetch display if server is not mid-update — if it is, the poll's
          // updating-transition detection (true→false) will call fetchDisplay the
          // moment the update finishes, which is more reliable than a wasted call now.
          if (st.forecast_available && !st.updating_forecast) {
            fetchDisplay()
          }

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
  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const st = await api.status()
        setStatus(st)

        if (st.forecast_stale && !st.updating_forecast) api.refreshForecast()
        if (st.measurement_stale && !st.updating_measurements && isInDaylightWindow(rawForecastRef.current)) {
          api.refreshMeasure()
        }

        // ── Primary detection: updating flag transitions ──────────────────
        // These fire the instant an update completes, regardless of age values.
        const wasFcUpdating = prevFcUpdatingRef.current
        const wasMsUpdating = prevMsUpdatingRef.current
        prevFcUpdatingRef.current = st.updating_forecast
        prevMsUpdatingRef.current = st.updating_measurements

        if (wasFcUpdating && !st.updating_forecast && st.forecast_available) {
          // Forecast update just finished → fetch fresh display + raw + measurements
          fetchDisplay()
          return
        }

        if (wasMsUpdating && !st.updating_measurements && st.measurements_available) {
          // Measurement update just finished → fetch fresh measurements
          try {
            const meas = await api.measurements()
            setMeasure(meas)
            saveMeasCache(meas)
            // Also grab raw forecast if it hasn't loaded yet (e.g. was mid-update on init)
            if (!rawForecastRef.current) {
              const raw = await api.rawForecast(settingsRef.current.model)
              if (raw.forecast) {
                setRaw(raw.forecast)
                rawForecastRef.current = raw.forecast
                saveRawCache(settingsRef.current.model, raw.forecast)
              }
            }
          } catch (e) { console.error('meas update', e) }
          return
        }

        // ── Fallback: age-based detection (handles missed transitions) ────
        const prevMeasAge = prevMeasAgeRef.current
        const currMeasAge = st.measurement_age_seconds
        if (prevMeasAge != null && currMeasAge != null && currMeasAge < prevMeasAge - 30) {
          try {
            const meas = await api.measurements()
            setMeasure(meas)
            saveMeasCache(meas)
          } catch (e) { console.error('meas live-update', e) }
        }
        prevMeasAgeRef.current = currMeasAge

        const prevForecastAge = prevForecastAgeRef.current
        const currForecastAge = st.forecast_age_seconds
        prevForecastAgeRef.current = currForecastAge
        if (prevForecastAge != null && currForecastAge != null && currForecastAge < prevForecastAge - 30) {
          fetchDisplay()
          return
        }

        // ── Last resort: no display data at all yet ───────────────────────
        if (st.forecast_available && !displayRef.current && !isFetchingDisplay.current) {
          fetchDisplay()
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
    ptIdx,   setPtIdx,
    refreshForecast: api.refreshForecast,
    refreshMeasure:  api.refreshMeasure,
    refetchDisplay:  fetchDisplay,
  }
}