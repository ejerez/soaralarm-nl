import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api.js'

const POLL_MS = 10_000   // poll status every 10 s

export function useSoarData() {
  const [status, setStatus]           = useState(null)
  const [points, setPoints]           = useState([])
  const [days, setDays]               = useState([])
  const [wings, setWings]             = useState({})
  const [displayForecast, setDisplay] = useState(null)
  const [rawForecast, setRaw]         = useState(null)
  const [measurements, setMeasure]    = useState(null)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)

  // User settings (persisted in localStorage)
  const [model, setModel]         = useState(() => localStorage.getItem('model')       || 'soar_knmi')
  const [timeStart, setTimeStart] = useState(() => localStorage.getItem('timeStart')   || '00:00')
  const [timeEnd, setTimeEnd]     = useState(() => localStorage.getItem('timeEnd')     || '23:59')
  const [wing, setWing]           = useState(() => localStorage.getItem('wing')        || '')
  const [wingSize, setWingSize]   = useState(() => {
    const s = localStorage.getItem('wingSize')
    return s !== null ? Number(s) : null
  })
  const [dateIdx, setDateIdx]     = useState(1)

  const prevModelRef = useRef(model)
  const prevTsRef    = useRef(timeStart)
  const prevTeRef    = useRef(timeEnd)
  const prevWingRef  = useRef(wing)
  const prevWingSzRef = useRef(wingSize)

  // ── Save settings to localStorage ────────────────────────────────────────
  useEffect(() => { localStorage.setItem('model',    model)    }, [model])
  useEffect(() => { localStorage.setItem('timeStart', timeStart) }, [timeStart])
  useEffect(() => { localStorage.setItem('timeEnd',  timeEnd)  }, [timeEnd])
  useEffect(() => { localStorage.setItem('wing',     wing)     }, [wing])
  useEffect(() => {
    if (wingSize !== null) localStorage.setItem('wingSize', wingSize)
  }, [wingSize])

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

        // If no wing is stored yet, default to the first wing in the list
        const storedWing = localStorage.getItem('wing')
        const storedSize = localStorage.getItem('wingSize')
        const firstKey   = Object.keys(wgs)[0]
        if ((!storedWing || !wgs[storedWing]) && firstKey) {
          setWing(firstKey)
          if (!storedSize) setWingSize(wgs[firstKey].default_size)
        } else if (storedWing && wgs[storedWing] && !storedSize) {
          setWingSize(wgs[storedWing].default_size)
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

  // ── Fetch display forecast (called when model/times/wing/forecast ready) ─
  const fetchDisplay = useCallback(async () => {
    try {
      const [disp, raw, meas] = await Promise.all([
        api.displayForecast(model, timeStart, timeEnd, wing || undefined, wingSize || undefined),
        api.rawForecast(model),
        api.measurements(),
      ])
      if (disp.display) setDisplay(disp.display)
      if (raw.forecast) setRaw(raw.forecast)
      setMeasure(meas)
    } catch (e) {
      console.error('fetchDisplay', e)
    }
  }, [model, timeStart, timeEnd, wing, wingSize])

  // ── Poll status and refresh display data when ready ───────────────────────
  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const st = await api.status()
        setStatus(st)

        const settingsChanged =
          model    !== prevModelRef.current  ||
          timeStart !== prevTsRef.current    ||
          timeEnd  !== prevTeRef.current     ||
          wing     !== prevWingRef.current   ||
          wingSize !== prevWingSzRef.current

        prevModelRef.current  = model
        prevTsRef.current     = timeStart
        prevTeRef.current     = timeEnd
        prevWingRef.current   = wing
        prevWingSzRef.current = wingSize

        // Trigger backend refresh if stale
        if (st.forecast_stale && !st.updating_forecast) {
          api.refreshForecast()
        }
        if (st.measurement_stale && !st.updating_measurements) {
          api.refreshMeasure()
        }

        // Reload display data if forecast just became available or settings changed
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
  }, [model, timeStart, timeEnd, wing, wingSize, displayForecast, fetchDisplay])

  // Initial display fetch once status confirms data available
  useEffect(() => {
    if (status?.forecast_available && status?.measurements_available && !displayForecast) {
      fetchDisplay()
    }
  }, [status, displayForecast, fetchDisplay])

  return {
    // data
    status, points, days, wings, displayForecast, rawForecast, measurements,
    loading, error,
    // state
    model, setModel,
    timeStart, setTimeStart,
    timeEnd, setTimeEnd,
    wing, setWing,
    wingSize, setWingSize,
    dateIdx, setDateIdx,
    // actions
    refreshForecast: api.refreshForecast,
    refreshMeasure: api.refreshMeasure,
    refetchDisplay: fetchDisplay,
  }
}