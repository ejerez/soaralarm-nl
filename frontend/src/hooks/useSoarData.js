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

export function useSoarData() {
  const [status, setStatus]               = useState(null)
  const [points, setPoints]               = useState([])
  const [days, setDays]                   = useState([])
  const [wings, setWings]                 = useState({})
  const [displayForecast, setDisplay]     = useState(null)
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
  const [dateIdx, setDateIdx]           = useState(1)

  const prevModelRef = useRef(model)
  const prevTsRef    = useRef(timeStart)
  const prevTeRef    = useRef(timeEnd)
  const prevWingsRef = useRef(selectedWings)

  // ── Save settings to localStorage ────────────────────────────────────────
  useEffect(() => { localStorage.setItem('model',    model) },    [model])
  useEffect(() => { localStorage.setItem('timeStart', timeStart) }, [timeStart])
  useEffect(() => { localStorage.setItem('timeEnd',  timeEnd) },  [timeEnd])
  useEffect(() => {
    localStorage.setItem('selectedWings', JSON.stringify(selectedWings))
  }, [selectedWings])

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
        api.displayForecast(model, timeStart, timeEnd, selectedWings),
        api.rawForecast(model),
        api.measurements(),
      ])
      if (disp.display) setDisplay(disp.display)
      if (raw.forecast) setRaw(raw.forecast)
      setMeasure(meas)
    } catch (e) {
      console.error('fetchDisplay', e)
    }
  }, [model, timeStart, timeEnd, selectedWings])

  // ── Poll status ───────────────────────────────────────────────────────────
  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const st = await api.status()
        setStatus(st)

        const wingsChanged = JSON.stringify(selectedWings) !== JSON.stringify(prevWingsRef.current)
        const settingsChanged =
          model     !== prevModelRef.current ||
          timeStart !== prevTsRef.current    ||
          timeEnd   !== prevTeRef.current    ||
          wingsChanged

        prevModelRef.current = model
        prevTsRef.current    = timeStart
        prevTeRef.current    = timeEnd
        prevWingsRef.current = selectedWings

        if (st.forecast_stale && !st.updating_forecast)       api.refreshForecast()
        if (st.measurement_stale && !st.updating_measurements) api.refreshMeasure()

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
  }, [model, timeStart, timeEnd, selectedWings, displayForecast, fetchDisplay])

  // Initial display fetch once data is available
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
    selectedWings, setSelectedWings,
    dateIdx, setDateIdx,
    // actions
    refreshForecast: api.refreshForecast,
    refreshMeasure:  api.refreshMeasure,
    refetchDisplay:  fetchDisplay,
  }
}