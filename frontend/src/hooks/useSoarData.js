import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api.js'

const POLL_MS = 10_000   // poll status every 10 s

function loadSelectedWings() {
  try {
    const raw = localStorage.getItem('selectedWings')
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

// Returns true if now is within 90 minutes of sunrise/sunset for today's first point
function isInDaylightWindow(rawForecast) {
  try {
    const todayFc = rawForecast?.[1]?.[0]  // dateIdx=1 is today, first point
    if (!todayFc?.sunrise || !todayFc?.sunset) return true  // if unknown, allow refresh
    const now     = Date.now()
    const sunrise = new Date(todayFc.sunrise).getTime()
    const sunset  = new Date(todayFc.sunset).getTime()
    const MARGIN  = 90 * 60 * 1000  // 90 minutes in ms
    return now >= sunrise - MARGIN && now <= sunset + MARGIN
  } catch {
    return true  // if anything fails, allow refresh
  }
}

export function useSoarData() {
  const [status, setStatus]               = useState(null)
  const [points, setPoints]               = useState([])
  const [days, setDays]                   = useState([])
  const [wings, setWings]                 = useState({})
  const [displayForecast, setDisplay]     = useState(null)
  const [certainty, setCertainty]         = useState(null)
  const [rawForecast, setRaw]             = useState(null)
  const [measurements, setMeasure]        = useState(null)
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState(null)

  // User settings (persisted in localStorage)
  const [model, setModel]               = useState(() => localStorage.getItem('model')     || 'soar_knmi')
  const [timeStart, setTimeStart]       = useState(() => localStorage.getItem('timeStart') || '00:00')
  const [timeEnd, setTimeEnd]           = useState(() => localStorage.getItem('timeEnd')   || '23:59')
  // selectedWings: Array<{ key: string, size: number }>
  const [selectedWings, setSelectedWings] = useState(loadSelectedWings)
  const [weight, setWeight]             = useState(() => {
    const s = localStorage.getItem('weight')
    return s !== null ? parseFloat(s) : 75.0
  })
  const [dateIdx, setDateIdx]           = useState(1)

  const prevModelRef   = useRef(model)
  const prevTsRef      = useRef(timeStart)
  const prevTeRef      = useRef(timeEnd)
  const prevWingsRef   = useRef(selectedWings)
  const prevWeightRef  = useRef(weight)
  const prevMeasAgeRef = useRef(null)

  // ── Save settings to localStorage ────────────────────────────────────────
  useEffect(() => { localStorage.setItem('model',    model) },    [model])
  useEffect(() => { localStorage.setItem('timeStart', timeStart) }, [timeStart])
  useEffect(() => { localStorage.setItem('timeEnd',  timeEnd) },  [timeEnd])
  useEffect(() => {
    localStorage.setItem('selectedWings', JSON.stringify(selectedWings))
  }, [selectedWings])
  useEffect(() => { localStorage.setItem('weight', weight) }, [weight])

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        const [pts, d, st, wgs] = await Promise.all([
          api.points(), api.days(), api.status(), api.wings()
        ])
        setPoints(pts)
        setDays(d.days)
        setStatus(st)
        setWings(wgs)

        // Default to first wing if nothing is stored yet
        const stored = loadSelectedWings()
        const firstKey = Object.keys(wgs)[0]
        if (stored.length === 0 && firstKey) {
          const defaults = [{ key: firstKey, size: wgs[firstKey].default_size }]
          setSelectedWings(defaults)
        }

        if (st.forecast_stale && !st.updating_forecast) {
          await api.refreshForecast()
        }
        if (st.measurement_stale && !st.updating_measurements) {
          await api.refreshMeasure()
        }
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  // ── Fetch display forecast ────────────────────────────────────────────────
  const fetchDisplay = useCallback(async () => {
    try {
      const [disp, raw, meas] = await Promise.all([
        api.displayForecast(model, timeStart, timeEnd, selectedWings, weight),
        api.rawForecast(model),
        api.measurements(),
      ])
      if (disp.display) setDisplay(disp.display)
      if (disp.certainty) setCertainty(disp.certainty)
      if (raw.forecast) setRaw(raw.forecast)
      setMeasure(meas)
    } catch (e) {
      console.error('fetchDisplay', e)
    }
  }, [model, timeStart, timeEnd, selectedWings, weight])

  // ── Poll status ───────────────────────────────────────────────────────────
  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const st = await api.status()
        setStatus(st)

        const wingsChanged = JSON.stringify(selectedWings) !== JSON.stringify(prevWingsRef.current)
        const settingsChanged =
          model     !== prevModelRef.current  ||
          timeStart !== prevTsRef.current     ||
          timeEnd   !== prevTeRef.current     ||
          weight    !== prevWeightRef.current ||
          wingsChanged

        prevModelRef.current  = model
        prevTsRef.current     = timeStart
        prevTeRef.current     = timeEnd
        prevWingsRef.current  = selectedWings
        prevWeightRef.current = weight

        if (st.forecast_stale && !st.updating_forecast) api.refreshForecast()

        // Only refresh measurements during the daylight window (±90 min of sunrise/sunset)
        if (st.measurement_stale && !st.updating_measurements && isInDaylightWindow(rawForecast)) {
          api.refreshMeasure()
        }

        // Detect when a measurement refresh just completed (age reset to a small value)
        // and pull the updated data into UI state without waiting for a full fetchDisplay
        const prevMeasAge = prevMeasAgeRef.current
        const currMeasAge = st.measurement_age_seconds
        const measJustRefreshed = (
          prevMeasAge != null &&
          currMeasAge != null &&
          currMeasAge < prevMeasAge - 30   // age dropped → refresh completed
        )
        prevMeasAgeRef.current = currMeasAge
        if (measJustRefreshed) {
          try {
            const meas = await api.measurements()
            setMeasure(meas)
          } catch (e) { console.error('meas live-update', e) }
        }

        if (
          (st.forecast_available && st.measurements_available && !displayForecast) ||
          settingsChanged
        ) {
          fetchDisplay()
        }
      } catch (e) {
        console.error('poll', e)
      }
    }, POLL_MS)

    return () => clearInterval(poll)
  }, [model, timeStart, timeEnd, selectedWings, weight, displayForecast, fetchDisplay, rawForecast])

  // Initial display fetch once data is available
  useEffect(() => {
    if (status?.forecast_available && status?.measurements_available && !displayForecast) {
      fetchDisplay()
    }
  }, [status, displayForecast, fetchDisplay])

  return {
    // data
    status, points, days, wings, displayForecast, certainty, rawForecast, measurements,
    loading, error,
    // state
    model, setModel,
    timeStart, setTimeStart,
    timeEnd, setTimeEnd,
    selectedWings, setSelectedWings,
    weight, setWeight,
    dateIdx, setDateIdx,
    // actions
    refreshForecast: api.refreshForecast,
    refreshMeasure:  api.refreshMeasure,
    refetchDisplay:  fetchDisplay,
  }
}