import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { api, setApiScope } from '../api.js'
import { findBestLocationIndex } from '../locationSort.js'

const POLL_MS        = 10_000              // poll status every 10 s
const CACHE_TTL      = 2 * 60 * 60 * 1000  // 2 h — matches server forecast TTL
const MEAS_CACHE_TTL = 15 * 60 * 1000      // 15 min — matches server measurement refresh interval

// ── Country/mode scope for cache keys ────────────────────────────────────
function cacheScope() { return localStorage.getItem('soar_scope') || 'nl:para' }
function updateCacheScope(country, mode) { localStorage.setItem('soar_scope', `${country}:${mode}`) }

// ── Detect country from subdomain (e.g. nl.soaralarm.eu → "nl") ─────────
function detectCountryFromSubdomain() {
  try {
    const host = window.location.hostname
    const parts = host.split('.')
    // Match patterns like nl.soaralarm.eu or nl.soaralarm.localhost
    if (parts.length >= 3) {
      const sub = parts[0].toLowerCase()
      if (sub.length === 2) return sub  // 2-letter country code
    }
  } catch {}
  return null
}

// ── Display forecast cache ────────────────────────────────────────────────
function displayCacheKey(model, timeStart, timeEnd, selectedWings, weight, customWind, windMin, windMax) {
  return `soar_display_v3:${cacheScope()}:` + JSON.stringify({ model, timeStart, timeEnd, selectedWings, weight, customWind, windMin, windMax })
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
      Object.keys(localStorage).filter(k => k.startsWith('soar_display_v3:')).forEach(k => localStorage.removeItem(k))
      localStorage.setItem(key, JSON.stringify({ display, certainty, savedAt: Date.now() }))
    } catch {}
  }
}

// ── Measurements cache ────────────────────────────────────────────────────
function measCacheKey() { return `soar_measurements_v3:${cacheScope()}` }
function loadMeasCache() {
  try {
    const raw = localStorage.getItem(measCacheKey())
    if (!raw) return null
    const { data, savedAt } = JSON.parse(raw)
    if (Date.now() - savedAt > MEAS_CACHE_TTL) return null
    return data
  } catch { return null }
}
function saveMeasCache(data) {
  try {
    localStorage.setItem(measCacheKey(), JSON.stringify({ data, savedAt: Date.now() }))
  } catch {}
}

// ── Raw forecast cache ────────────────────────────────────────────────────
function rawCacheKey(model) { return `soar_raw_v2:${cacheScope()}:${model}` }
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
      Object.keys(localStorage).filter(k => k.startsWith('soar_raw_v2:')).forEach(k => localStorage.removeItem(k))
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
    model:         localStorage.getItem('model')        || '',
    timeStart:     localStorage.getItem('timeStart')    || '00:00',
    timeEnd:       localStorage.getItem('timeEnd')      || '23:59',
    selectedWings: loadSelectedWings(),
    weight:        parseFloat(localStorage.getItem('weight')  ?? '70'),
    customTimeWindow: localStorage.getItem('customTimeWindow') === 'true',
    customWind:    localStorage.getItem('customWind') === 'true',
    windMin:       parseFloat(localStorage.getItem('windMin') ?? '15'),
    windMax:       parseFloat(localStorage.getItem('windMax') ?? '60'),
    speedUnit:     localStorage.getItem('speedUnit')    || 'km/h',
    altFont:   localStorage.getItem('altFont') === 'true',
    largeFont: localStorage.getItem('largeFont') === 'true',
    outdoorsMode:  localStorage.getItem('outdoorsMode') === 'true',
    autoModelSelection: localStorage.getItem('autoModelSelection') !== 'false',
  }
}

// ── Compute default model per day from model definitions ────────────────
function computeDefaultModelByDay(models) {
  const modelKeys = Object.keys(models)
  if (!modelKeys.length) return []
  const arr = []
  for (const [key, m] of Object.entries(models)) {
    if (m.default) {
      for (const di of m.default) {
        arr[di] = key
      }
    }
  }
  const fallback = modelKeys[0]
  const maxLen = Math.max(arr.length, 8)
  for (let i = 0; i < maxLen; i++) {
    if (!arr[i]) arr[i] = fallback
  }
  return arr
}

// ── Resolve initial country and mode ─────────────────────────────────────
function resolveInitialScope() {
  // Country: subdomain > localStorage > fallback "nl"
  const subCountry = detectCountryFromSubdomain()
  const storedScope = cacheScope().split(':')
  const country = subCountry || storedScope[0] || 'nl'
  const mode = storedScope[1] || 'para'
  return { country, mode }
}

export function useSoarData() {
  // ── Read initial settings + cache exactly once (inside useRef) ───────────
  const initRef = useRef(null)
  if (!initRef.current) {
    const settings = readSettingsFromStorage()
    const scope = resolveInitialScope()
    // Set API scope before any requests
    updateCacheScope(scope.country, scope.mode)
    setApiScope(scope.country, scope.mode)
    const cacheKey = displayCacheKey(
      settings.model, settings.timeStart, settings.timeEnd,
      settings.selectedWings, settings.weight,
      settings.customWind, settings.windMin, settings.windMax,
    )
    initRef.current = {
      settings,
      scope,
      cache: loadDisplayCache(cacheKey),
      measCache: loadMeasCache(),
      rawCache: loadRawCache(settings.model),
    }
  }
  const { settings: initSettings, scope: initScope, cache: initCache, measCache: initMeasCache, rawCache: initRawCache } = initRef.current

  const [status, setStatus]           = useState(null)
  const [points, setPoints]           = useState([])
  const [days, setDays]               = useState([])
  const [wings, setWings]             = useState({})
  const [models, setModels]           = useState({})
  const [ranges, setRanges]           = useState({})
  const [countries, setCountries]     = useState({})
  const [modes, setModes]             = useState({})
  const [country, setCountry]         = useState(initScope.country)
  const [mode, setMode]               = useState(initScope.mode)
  const [displayForecast, setDisplay] = useState(initCache?.display   ?? null)
  const [certainty, setCertainty]     = useState(initCache?.certainty ?? null)
  const [rawForecast, setRaw]         = useState(initRawCache ?? null)
  const [measurements, setMeasure]    = useState(initMeasCache ?? null)
  const [altStationPrefs, setAltStationPrefs] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`altStationPrefs:${cacheScope()}`) || '{}') } catch { return {} }
  })
  const [loading, setLoading]         = useState(!initCache)
  const [error, setError]             = useState(null)

  // User settings (persisted in localStorage)
  const [model, setModel]               = useState(initSettings.model)
  const [timeStart, setTimeStart]       = useState(initSettings.timeStart)
  const [timeEnd, setTimeEnd]           = useState(initSettings.timeEnd)
  const [selectedWings, setSelectedWings] = useState(initSettings.selectedWings)
  const [weight, setWeight]             = useState(initSettings.weight)
  const [customTimeWindow, setCustomTimeWindow] = useState(initSettings.customTimeWindow)
  const [customWind, setCustomWind]     = useState(initSettings.customWind)
  const [windMin, setWindMin]           = useState(initSettings.windMin)
  const [windMax, setWindMax]           = useState(initSettings.windMax)
  const [speedUnit, setSpeedUnit]       = useState(initSettings.speedUnit)
  const [altFont, setAltFont]           = useState(initSettings.altFont)
  const [largeFont, setLargeFont]       = useState(initSettings.largeFont)
  const [outdoorsMode, setOutdoorsMode] = useState(initSettings.outdoorsMode)
  const [autoModelSelection, setAutoModelSelection] = useState(initSettings.autoModelSelection)
  const [dateIdx, setDateIdx]           = useState(1)
  const [ptIdx,   setPtIdx]             = useState(0)
  const [selectedTime, setSelectedTime] = useState(null)

  // Auto-select best point on date change and when forecast first loads.
  // Ref starts as null so the very first forecast load triggers selection.
  const prevAutoDateRef = useRef(null)
  useEffect(() => {
    if (!displayForecast || !points.length) return
    if (prevAutoDateRef.current === dateIdx) return
    prevAutoDateRef.current = dateIdx
    const dayPf = displayForecast[dateIdx] || []
    const certDi = certainty?.[dateIdx]
    setPtIdx(findBestLocationIndex(dayPf, certDi, points))
  }, [dateIdx, displayForecast, certainty, points])

  // ── Refs ──────────────────────────────────────────────────────────────────
  const settingsRef = useRef(initSettings)
  const isFetchingDisplay = useRef(false)
  const pendingFetch      = useRef(false)
  const displayRef         = useRef(initCache?.display ?? null)
  const prevMeasAgeRef     = useRef(null)
  const prevForecastAgeRef = useRef(null)
  const rawForecastRef     = useRef(initRawCache ?? null)
  const prevFcUpdatingRef  = useRef(false)
  const prevMsUpdatingRef  = useRef(false)
  const modelsRef          = useRef({})
  const skipCacheRef       = useRef(false)

  // ── Effective time window ────────────────────────────────────────────────
  // When custom is off, use server-provided sunrise-based defaults
  const defaultTimeStart = status?.default_time_start ?? '07:00'
  const defaultTimeEnd   = status?.default_time_end   ?? '21:00'
  const effectiveTimeStart = customTimeWindow ? timeStart : defaultTimeStart
  const effectiveTimeEnd   = customTimeWindow ? timeEnd   : defaultTimeEnd

  // ── Keep refs in sync with state ─────────────────────────────────────────
  useEffect(() => {
    settingsRef.current = { model, timeStart: effectiveTimeStart, timeEnd: effectiveTimeEnd, selectedWings, weight, customWind, windMin, windMax, autoModelSelection }
  }, [model, effectiveTimeStart, effectiveTimeEnd, selectedWings, weight, customWind, windMin, windMax, autoModelSelection])

  useEffect(() => { rawForecastRef.current = rawForecast }, [rawForecast])
  useEffect(() => { modelsRef.current = models }, [models])

  const defaultModelByDay = useMemo(() => computeDefaultModelByDay(models), [models])

  // ── Save settings to localStorage ────────────────────────────────────────
  useEffect(() => { localStorage.setItem('model',         model) },        [model])
  useEffect(() => { localStorage.setItem('timeStart',     timeStart) },    [timeStart])
  useEffect(() => { localStorage.setItem('timeEnd',       timeEnd) },      [timeEnd])
  useEffect(() => { localStorage.setItem('selectedWings', JSON.stringify(selectedWings)) }, [selectedWings])
  useEffect(() => { localStorage.setItem('weight',        weight) },       [weight])
  useEffect(() => { localStorage.setItem('customTimeWindow', customTimeWindow) }, [customTimeWindow])
  useEffect(() => { localStorage.setItem('customWind',    customWind) },   [customWind])
  useEffect(() => { localStorage.setItem('windMin',       windMin) },      [windMin])
  useEffect(() => { localStorage.setItem('windMax',       windMax) },      [windMax])
  useEffect(() => { localStorage.setItem('speedUnit',     speedUnit) },    [speedUnit])
  useEffect(() => { localStorage.setItem('altFont',   altFont) },  [altFont])
  useEffect(() => { localStorage.setItem('largeFont', largeFont) }, [largeFont])
  useEffect(() => { localStorage.setItem('outdoorsMode',  outdoorsMode) }, [outdoorsMode])
  useEffect(() => { localStorage.setItem('autoModelSelection', autoModelSelection) }, [autoModelSelection])
  useEffect(() => { localStorage.setItem(`altStationPrefs:${cacheScope()}`, JSON.stringify(altStationPrefs)) }, [altStationPrefs])

  // ── Fetch display forecast ────────────────────────────────────────────────
  const fetchDisplay = useCallback(async () => {
    if (isFetchingDisplay.current) {
      pendingFetch.current = true
      return
    }
    isFetchingDisplay.current = true
    pendingFetch.current = false
    const skipCache = skipCacheRef.current
    skipCacheRef.current = false
    try {
      const { model, timeStart, timeEnd, selectedWings, weight, customWind, windMin, windMax, autoModelSelection } = settingsRef.current
      const wMin = customWind ? windMin : undefined
      const wMax = customWind ? windMax : undefined
      const modelByDay = computeDefaultModelByDay(modelsRef.current)

      if (autoModelSelection && modelByDay.length > 0) {
        // Auto mode: fetch for each unique default model, then compose per-day
        const uniqueModels = [...new Set(modelByDay.filter(Boolean))]

        const displayResults = {}
        await Promise.all(uniqueModels.map(async (m) => {
          const key = displayCacheKey(m, timeStart, timeEnd, selectedWings, weight, customWind, windMin, windMax)
          const cached = skipCache ? null : loadDisplayCache(key)
          if (cached) {
            displayResults[m] = cached
          } else {
            const disp = await api.displayForecast(m, timeStart, timeEnd, selectedWings, weight, wMin, wMax)
            if (disp.display) {
              displayResults[m] = { display: disp.display, certainty: disp.certainty }
              saveDisplayCache(key, disp.display, disp.certainty)
            }
          }
        }))

        // Compose: for each day, pick from the correct model
        const maxDays = Math.max(0, ...Object.values(displayResults).map(r => r.display?.length || 0))
        const combined = []
        for (let di = 0; di < maxDays; di++) {
          const m = modelByDay[di] || uniqueModels[0]
          combined[di] = displayResults[m]?.display?.[di] || null
        }
        setDisplay(combined)
        displayRef.current = combined

        const anyCert = Object.values(displayResults).find(r => r.certainty)?.certainty
        if (anyCert) setCertainty(anyCert)

        // Fetch raw for each unique model and compose
        const measPromise = api.measurements()
        const rawResults = {}
        await Promise.all(uniqueModels.map(async (m) => {
          const cached = skipCache ? null : loadRawCache(m)
          if (cached) {
            rawResults[m] = cached
          } else {
            const raw = await api.rawForecast(m)
            if (raw?.forecast) {
              rawResults[m] = raw.forecast
              saveRawCache(m, raw.forecast)
            }
          }
        }))

        const maxRawDays = Math.max(0, ...Object.values(rawResults).map(r => r?.length || 0))
        const combinedRaw = []
        for (let di = 0; di < maxRawDays; di++) {
          const m = modelByDay[di] || uniqueModels[0]
          combinedRaw[di] = rawResults[m]?.[di] || null
        }
        setRaw(combinedRaw)
        rawForecastRef.current = combinedRaw

        try {
          const meas = await measPromise
          if (meas) { setMeasure(meas); saveMeasCache(meas) }
        } catch {}

      } else {
        // Manual mode: single model for all days
        const disp = await api.displayForecast(
          model, timeStart, timeEnd, selectedWings, weight, wMin, wMax,
        )
        if (disp.display) {
          setDisplay(disp.display)
          displayRef.current = disp.display
          const key = displayCacheKey(model, timeStart, timeEnd, selectedWings, weight, customWind, windMin, windMax)
          saveDisplayCache(key, disp.display, disp.certainty)
        }
        if (disp.certainty) setCertainty(disp.certainty)

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

  // ── Country/mode switching ──────────────────────────────────────────────
  const switchConfig = useCallback(async (newCountry, newMode) => {
    try {
      // Update scope — all subsequent API calls use these params
      setApiScope(newCountry, newMode)
      updateCacheScope(newCountry, newMode)
      setCountry(newCountry)
      setMode(newMode)

      const [pts, d, st, wgs, mods, rng] = await Promise.all([
        api.points(), api.days(), api.status(), api.wings(), api.models(), api.ranges()
      ])
      setPoints(pts)
      setDays(d.days)
      setStatus(st)
      setWings(wgs)
      setModels(mods)
      modelsRef.current = mods
      setRanges(rng)

      const modelKeys = Object.keys(mods)
      if (!mods[settingsRef.current.model] && modelKeys.length > 0) {
        const first = modelKeys[0]
        setModel(first)
        settingsRef.current = { ...settingsRef.current, model: first }
      }

      const firstWingKey = Object.keys(wgs)[0]
      const valid = settingsRef.current.selectedWings.filter(w => wgs[w.key])
      if (valid.length === 0 && firstWingKey) {
        const corrected = [{ key: firstWingKey, size: wgs[firstWingKey].default_size }]
        setSelectedWings(corrected)
        settingsRef.current = { ...settingsRef.current, selectedWings: corrected }
      } else if (valid.length < settingsRef.current.selectedWings.length) {
        setSelectedWings(valid)
        settingsRef.current = { ...settingsRef.current, selectedWings: valid }
      }

      try { setAltStationPrefs(JSON.parse(localStorage.getItem(`altStationPrefs:${newCountry}:${newMode}`) || '{}')) } catch { setAltStationPrefs({}) }

      setDisplay(null)
      displayRef.current = null
      setRaw(null)
      rawForecastRef.current = null
      setMeasure(null)

      if (st.forecast_available && !st.updating_forecast) {
        fetchDisplay()
      }
    } catch (e) {
      console.error('switchConfig', e)
    }
  }, [fetchDisplay])

  // ── Re-fetch immediately when settings change (don't wait for poll) ───────
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    fetchDisplay()
  }, [model, effectiveTimeStart, effectiveTimeEnd, selectedWings, weight, customWind, windMin, windMax, autoModelSelection, fetchDisplay])

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const MAX_ATTEMPTS = 5
      const DELAYS = [1000, 2000, 3000, 5000, 8000]
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          const [pts, d, st, wgs, mods, rng, ctrs, mds] = await Promise.all([
            api.points(), api.days(), api.status(), api.wings(), api.models(), api.ranges(),
            api.countries(), api.modes()
          ])
          setPoints(pts)
          setDays(d.days)
          setStatus(st)
          setWings(wgs)
          setModels(mods)
          modelsRef.current = mods
          setRanges(rng)
          setCountries(ctrs)
          setModes(mds)

          // Validate stored model key against loaded models; fall back to first key
          const modelKeys = Object.keys(mods)
          const storedModel = settingsRef.current.model
          if ((!storedModel || !mods[storedModel]) && modelKeys.length > 0) {
            const firstModelKey = modelKeys[0]
            setModel(firstModelKey)
            settingsRef.current = { ...settingsRef.current, model: firstModelKey }
          }

          // Invalidate display cache if the point count has changed
          const cachedPointCount = displayRef.current?.[0]?.length ?? 0
          if (cachedPointCount > 0 && cachedPointCount !== pts.length) {
            setDisplay(null)
            displayRef.current = null
            const s = settingsRef.current
            try { localStorage.removeItem(displayCacheKey(s.model, s.timeStart, s.timeEnd, s.selectedWings, s.weight, s.customWind, s.windMin, s.windMax)) } catch {}
          }

          const stored = loadSelectedWings()
          const firstKey = Object.keys(wgs)[0]
          const validStored = stored.filter(w => wgs[w.key])
          if (validStored.length === 0 && firstKey) {
            const corrected = [{ key: firstKey, size: wgs[firstKey].default_size }]
            setSelectedWings(corrected)
            settingsRef.current = { ...settingsRef.current, selectedWings: corrected }
          } else if (validStored.length < stored.length) {
            setSelectedWings(validStored)
            settingsRef.current = { ...settingsRef.current, selectedWings: validStored }
          }

          if (st.forecast_stale && !st.updating_forecast) api.refreshForecast()
          if (st.measurement_stale && !st.updating_measurements) api.refreshMeasure()

          prevFcUpdatingRef.current = st.updating_forecast
          prevMsUpdatingRef.current = st.updating_measurements

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
        if (st.measurement_stale && !st.updating_measurements) {
          api.refreshMeasure()
        }

        const wasFcUpdating = prevFcUpdatingRef.current
        const wasMsUpdating = prevMsUpdatingRef.current
        prevFcUpdatingRef.current = st.updating_forecast
        prevMsUpdatingRef.current = st.updating_measurements

        // Update age refs before early returns to prevent stale comparisons
        const prevMeasAge = prevMeasAgeRef.current
        const currMeasAge = st.measurement_age_seconds
        prevMeasAgeRef.current = currMeasAge

        const prevForecastAge = prevForecastAgeRef.current
        const currForecastAge = st.forecast_age_seconds
        prevForecastAgeRef.current = currForecastAge

        if (wasFcUpdating && !st.updating_forecast && st.forecast_available) {
          skipCacheRef.current = true
          try { const d = await api.days(); setDays(d.days) } catch {}
          fetchDisplay()
          return
        }

        if (wasMsUpdating && !st.updating_measurements && st.measurements_available) {
          try {
            const meas = await api.measurements()
            if (meas) { setMeasure(meas); saveMeasCache(meas) }
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

        if (prevMeasAge != null && currMeasAge != null && currMeasAge < prevMeasAge - 30) {
          try {
            const meas = await api.measurements()
            setMeasure(meas)
            saveMeasCache(meas)
          } catch (e) { console.error('meas live-update', e) }
        }

        if (prevForecastAge != null && currForecastAge != null && currForecastAge < prevForecastAge - 30) {
          skipCacheRef.current = true
          try { const d = await api.days(); setDays(d.days) } catch {}
          fetchDisplay()
          return
        }

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
    status, points, days, wings, models, ranges,
    countries, modes, country, mode,
    displayForecast, certainty, rawForecast, measurements,
    altStationPrefs, setAltStationPrefs,
    loading, error,
    model, setModel,
    timeStart, setTimeStart,
    timeEnd, setTimeEnd,
    customTimeWindow, setCustomTimeWindow,
    effectiveTimeStart, effectiveTimeEnd,
    defaultTimeStart, defaultTimeEnd,
    selectedWings, setSelectedWings,
    weight, setWeight,
    customWind, setCustomWind,
    windMin, setWindMin,
    windMax, setWindMax,
    speedUnit, setSpeedUnit,
    altFont, setAltFont,
    largeFont, setLargeFont,
    outdoorsMode, setOutdoorsMode,
    autoModelSelection, setAutoModelSelection,
    defaultModelByDay,
    dateIdx, setDateIdx,
    ptIdx,   setPtIdx,
    selectedTime, setSelectedTime,
    refreshForecast: api.refreshForecast,
    refreshMeasure:  api.refreshMeasure,
    refetchDisplay:  fetchDisplay,
    switchConfig,
  }
}
