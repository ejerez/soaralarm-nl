import React, { useState, useMemo, useEffect, useRef } from 'react'
import { fs, fsc } from '../fs.js'
import {
  ComposedChart, Area, Line, XAxis, YAxis, Scatter,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
  ReferenceArea,
} from 'recharts'

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  card:      '#262626',
  raised:    '#2e2e2e',
  border:    '#3d3d3d',
  borderDim: '#353535',
  text:      '#dedede',
  text2:     '#9a9a9a',
  text3:     '#757575',
  font:      "'Atkinson Hyperlegible', system-ui, sans-serif",
}

const card_ = { background: T.card, border: `1px solid ${T.borderDim}`, borderRadius: 8, padding: '14px 0', marginBottom: 16 }
const sectionTitle_ = { fontSize: fs(12), fontWeight: 600, color: T.text2, marginBottom: 12, paddingLeft: 14, letterSpacing: '0.04em', textTransform: 'uppercase' }
const select_ = { background: T.raised, color: T.text, border: `1px solid ${T.border}`, borderRadius: 6, padding: '6px 10px', fontSize: fs(13), cursor: 'pointer', marginBottom: 14, fontFamily: T.font }
const TOOLTIP = { contentStyle: { background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: fs(12), fontFamily: T.font }, labelStyle: { color: T.text2 }, labelFormatter: fmtTime }
const GRID_STROKE = '#2a2a2a'
const TICK  = { fill: T.text2, fontSize: fs(11), fontFamily: T.font }

function fmtTime(ms) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

// Linear interpolation function with rounding (fallback)
function interpolateLinear(x1, y1, x2, y2, x) {
  if (x1 === x2) return y1 // Avoid division by zero
  const t = (x - x1) / (x2 - x1)
  const result = y1 + t * (y2 - y1)
  return Math.round(result * 10) / 10 // Round to 1 decimal place
}

// Cubic spline interpolation for smoother transitions
function interpolateCubic(x0, y0, x1, y1, x2, y2, x3, y3, x) {
  // Calculate t parameter (normalized position between x1 and x2)
  const t = (x - x1) / (x2 - x1)
  
  // Calculate differences
  const h1 = x1 - x0
  const h2 = x2 - x1
  const h3 = x3 - x2
  
  // Avoid division by zero
  if (h1 === 0 || h2 === 0 || h3 === 0) {
    return interpolateLinear(x1, y1, x2, y2, x)
  }
  
  // Calculate slopes (using finite differences)
  const m1 = (y1 - y0) / h1
  const m2 = (y2 - y1) / h2
  const m3 = (y3 - y2) / h3
  
  // Calculate second derivatives (simplified Catmull-Rom approach)
  const d1 = (m2 - m1) / (h2 + h1)
  const d2 = (m3 - m2) / (h3 + h2)
  
  // Cubic interpolation formula
  const a = 2 * (y1 - y2) + d1 + d2
  const b = -3 * (y1 - y2) - 2 * d1 - d2
  const c = d1
  const d = y1
  
  // Evaluate cubic polynomial
  const result = a * t * t * t + b * t * t + c * t + d
  return Math.round(result * 10) / 10 // Round to 1 decimal place
}

function buildWindData(dayFc, meas, stationRef, convert, shortTermPrecip = null) {
  // stationRef is [api, code] e.g. ["rws", "ijmuiden.havenhoofd.zuid"]
  const fcPoints = dayFc.time.map((t, i) => ({
    ts:            new Date(t).getTime(),
    wind_speed:    convert(dayFc.wind_speed[i]),
    wind_gusts:    convert(dayFc.wind_gusts[i]),
    precipitation: parseFloat(dayFc.precipitation[i]?.toFixed(2)),
  }))

  if (!stationRef) return fcPoints
  const [api, code] = stationRef
  const wind = meas?.[api]?.[code]?.wind
  if (!wind?.timestamps?.length) return fcPoints

  // Bound measurements to the forecast time range
  const fcMin = fcPoints[0]?.ts
  const fcMax = fcPoints[fcPoints.length - 1]?.ts

  const measPoints = []
  wind.timestamps.forEach((ts, i) => {
    const lo = wind.wind_min[i]
    const hi = wind.wind_max[i]
    if (lo == null && hi == null) return
    const t = new Date(ts); if (isNaN(t.getTime())) return
    if (fcMin != null && t.getTime() < fcMin) return
    if (fcMax != null && t.getTime() > fcMax) return
    measPoints.push({
      ts: t.getTime(),
      meas_wind_min: convert(lo ?? hi),
      meas_wind_max: convert(hi ?? lo),
    })
  })

  // Add band field (max - min) for stacked fill-between rendering
  measPoints.forEach(m => { m.meas_wind_band = parseFloat((m.meas_wind_max - m.meas_wind_min).toFixed(1)) })

  // Merge: attach measurement min/max onto any forecast point within 5 min
  const FIVE_MIN = 5 * 60 * 1000
  fcPoints.forEach(fp => {
    const near = measPoints.find(m => Math.abs(m.ts - fp.ts) <= FIVE_MIN)
    if (near) {
      fp.meas_wind_min  = near.meas_wind_min
      fp.meas_wind_max  = near.meas_wind_max
      fp.meas_wind_band = near.meas_wind_band
    }
  })

  // Add short-term precipitation data as separate points (like measurements)
  const precipPoints = []
  if (shortTermPrecip?.timestamps?.length) {
    // Sort forecast points by timestamp for interpolation
    const sortedFcPoints = [...fcPoints].sort((a, b) => a.ts - b.ts)
    
    shortTermPrecip.timestamps.forEach((ts, i) => {
      const t = new Date(ts).getTime()
      if (t < fcMin || t > fcMax) return
      const val = shortTermPrecip.values[i]
      if (val == null) return
      
      // Use linear interpolation to get wind/gust values at this timestamp
      let interpolatedWindSpeed = null
      let interpolatedWindGusts = null
      
      // Find the segment where this timestamp falls
      for (let j = 0; j < sortedFcPoints.length - 1; j++) {
        const fp1 = sortedFcPoints[j]
        const fp2 = sortedFcPoints[j + 1]
        
        if (t >= fp1.ts && t <= fp2.ts) {
          // Use cubic spline interpolation for smoother transitions when we have enough points
          const fp0 = j > 0 ? sortedFcPoints[j - 1] : null
          const fp3 = j < sortedFcPoints.length - 2 ? sortedFcPoints[j + 2] : null
          
          // Interpolate wind speed
          if (fp1.wind_speed != null && fp2.wind_speed != null) {
            if (fp0 && fp3 && fp0.wind_speed != null && fp3.wind_speed != null) {
              // Use cubic spline interpolation for smoother transitions
              interpolatedWindSpeed = interpolateCubic(
                fp0.ts, fp0.wind_speed,
                fp1.ts, fp1.wind_speed,
                fp2.ts, fp2.wind_speed,
                fp3.ts, fp3.wind_speed,
                t
              )
            } else {
              // Fallback to linear interpolation
              interpolatedWindSpeed = interpolateLinear(
                fp1.ts, fp1.wind_speed,
                fp2.ts, fp2.wind_speed,
                t
              )
            }
          }
          
          // Interpolate wind gusts
          if (fp1.wind_gusts != null && fp2.wind_gusts != null) {
            if (fp0 && fp3 && fp0.wind_gusts != null && fp3.wind_gusts != null) {
              // Use cubic spline interpolation for smoother transitions
              interpolatedWindGusts = interpolateCubic(
                fp0.ts, fp0.wind_gusts,
                fp1.ts, fp1.wind_gusts,
                fp2.ts, fp2.wind_gusts,
                fp3.ts, fp3.wind_gusts,
                t
              )
            } else {
              // Fallback to linear interpolation
              interpolatedWindGusts = interpolateLinear(
                fp1.ts, fp1.wind_gusts,
                fp2.ts, fp2.wind_gusts,
                t
              )
            }
          }
          
          break
        }
      }
      
      // Fallback to nearest point if interpolation failed
      if (interpolatedWindSpeed == null || interpolatedWindGusts == null) {
        let nearestForecast = null
        let minDiff = Infinity
        sortedFcPoints.forEach(fp => {
          const diff = Math.abs(fp.ts - t)
          if (diff < minDiff) {
            minDiff = diff
            nearestForecast = fp
          }
        })
        interpolatedWindSpeed = interpolatedWindSpeed ?? nearestForecast?.wind_speed
        interpolatedWindGusts = interpolatedWindGusts ?? nearestForecast?.wind_gusts
      }
      
      precipPoints.push({
        ts: t,
        short_term_precip: val,  // Keep original value from backend
        precipitation: 0,         // Explicitly set forecast precipitation to 0 to prevent interpolation
        // Attach interpolated wind/gust data for tooltip use
        wind_speed: interpolatedWindSpeed,
        wind_gusts: interpolatedWindGusts,
      })
    })
  }

  // Set forecast precipitation to 0 between the first and last short-term precipitation timestamps
  if (shortTermPrecip?.timestamps?.length > 0) {
    const firstShortTermTime = new Date(shortTermPrecip.timestamps[0]).getTime()
    const lastShortTermTime = new Date(shortTermPrecip.timestamps[shortTermPrecip.timestamps.length - 1]).getTime()
    
    fcPoints.forEach(fp => {
      if (fp.ts >= firstShortTermTime && fp.ts <= lastShortTermTime) {
        fp.precipitation = 0  // Zero out forecast precipitation between first and last short-term precip timestamps
      }
    })
  }

  // Remove forecast points that have exact timestamp matches with short-term precip points
  // This prevents duplicate tooltips at the same timestamp
  if (precipPoints.length > 0) {
    const precipTimestamps = new Set(precipPoints.map(p => p.ts))
    // Filter out forecast points that have exact timestamp matches with precip points
    const filteredFcPoints = fcPoints.filter(fp => !precipTimestamps.has(fp.ts))
    // Combine: filtered forecast points + measurements + precip points
    return [...filteredFcPoints, ...measPoints, ...precipPoints].sort((a, b) => a.ts - b.ts)
  }

  // No short-term precip points, use original combination
  return [...fcPoints, ...measPoints, ...precipPoints].sort((a, b) => a.ts - b.ts)
}

function buildDirData(dayFc, meas, stationRef, heading) {
  function norm(deg) {
    let d = deg - heading
    if (d >  180) d -= 360
    if (d < -180) d += 360
    return heading + d
  }
  const rawDirs = dayFc.time.map((_, i) => dayFc.wind_direction[i])
  const unwrapped = rawDirs.map(v => norm(v))
  const points = dayFc.time.map((t, i) => ({ ts: new Date(t).getTime(), wind_dir: parseFloat(unwrapped[i].toFixed(1)) }))

  if (!stationRef) return points.sort((a,b) => a.ts - b.ts)
  const [api, code] = stationRef
  const ds = meas?.[api]?.[code]?.heading
  if (ds?.timestamps?.length && ds?.values?.length) {
    // Bound measurements to the forecast time range
    const fcMin = points[0]?.ts
    const fcMax = points[points.length - 1]?.ts
    ds.timestamps.forEach((ts, i) => {
      const v = ds.values[i]; if (v==null||!isFinite(v)) return
      const t = new Date(ts); if (isNaN(t.getTime())) return
      if (fcMin != null && t.getTime() < fcMin) return
      if (fcMax != null && t.getTime() > fcMax) return
      points.push({ ts: t.getTime(), meas_dir: parseFloat(norm(v).toFixed(1)) })
    })
  }
  return points.sort((a,b) => a.ts - b.ts)
}

function buildTempData(dayFc) {
  return dayFc.time.map((t, i) => ({
    ts: new Date(t).getTime(),
    temperature: parseFloat(dayFc.temperature[i]?.toFixed(1)),
    visibility:  parseFloat((dayFc.visibility[i]/1000)?.toFixed(2)),
  }))
}

function WindTooltip({ active, payload, label, unit = 'km/h' }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload ?? {}

  const box = (children) => (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, padding: '8px 10px', fontSize: fs(12), fontFamily: T.font }}>
      <div style={{ color: T.text2, marginBottom: 6 }}>{fmtTime(label)}</div>
      {children}
    </div>
  )

  // If measurement data exists at this point, show that instead of forecast
  if (d.meas_wind_min != null) {
    return box(
      <div style={{ color: T.text2 }}>
        <div style={{ color: 'rgba(255,255,255,0.8)', marginBottom: 3 }}>Measured</div>
        <div>max: <span style={{ color: T.text }}>{d.meas_wind_max} {unit}</span></div>
        <div>min: <span style={{ color: T.text }}>{d.meas_wind_min} {unit}</span></div>
        {d.short_term_precip != null && (
          <div style={{ marginTop: 3 }}><span style={{ color: '#1b8fe2' }}>Radar precip.:</span>{' '}<span style={{ color: T.text }}>{d.short_term_precip} mm</span></div>
        )}
      </div>
    )
  }

  // Determine short-term precipitation period (earliest to latest timestamp)
  let shortTermPeriod = null
  payload.forEach(p => {
    if (p.dataKey === 'short_term_precip' && p.value != null) {
      const precipPoint = p.payload
      if (precipPoint.ts != null) {
        if (!shortTermPeriod) {
          shortTermPeriod = { start: precipPoint.ts, end: precipPoint.ts }
        } else {
          shortTermPeriod.start = Math.min(shortTermPeriod.start, precipPoint.ts)
          shortTermPeriod.end = Math.max(shortTermPeriod.end, precipPoint.ts)
        }
      }
    }
  })

  const isInShortTermPeriod = shortTermPeriod && d.ts >= shortTermPeriod.start && d.ts <= shortTermPeriod.end
  const hasShortTermPrecip = payload.some(p => p.dataKey === 'short_term_precip' && p.value != null)
  
  // If we're in short-term precipitation period OR hovering over short-term point, show enhanced tooltip
  if (isInShortTermPeriod || d.short_term_precip != null) {
    // For short-term precip points, wind/gust data is pre-attached in buildWindData
    // For regular forecast points, use their own wind/gust data
    const windSpeed = d.wind_speed
    const windGusts = d.wind_gusts
    
    // Get the short-term precip value (either from current point or find nearest)
    let shortTermValue = d.short_term_precip
    if (shortTermValue == null && hasShortTermPrecip) {
      let minPrecipDiff = Infinity
      payload.forEach(p => {
        if (p.dataKey === 'short_term_precip' && p.value != null) {
          const precipPoint = p.payload
          const diff = Math.abs(precipPoint.ts - d.ts)
          if (diff < minPrecipDiff) {
            minPrecipDiff = diff
            shortTermValue = p.value
          }
        }
      })
    }

    return box(
      <div style={{ color: T.text2 }}>
        {(windSpeed != null || windGusts != null) && (
          <>
            {windGusts != null && (
              <div style={{ marginBottom: 2 }}><span style={{ color: '#c07028' }}>Gusts:</span>{' '}<span style={{ color: T.text }}>{windGusts} {unit}</span></div>
            )}
            {windSpeed != null && (
              <div style={{ marginBottom: 2 }}><span style={{ color: '#7aaaee' }}>Wind Speed:</span>{' '}<span style={{ color: T.text }}>{windSpeed} {unit}</span></div>
            )}
          </>
        )}
        {shortTermValue != null && (
          <div style={{ marginBottom: 2 }}><span style={{ color: '#1b8fe2' }}>Radar precip.:</span>{' '}<span style={{ color: T.text }}>{shortTermValue} mm</span></div>
        )}
      </div>
    )
  }

  // No measurement and not in short-term precip period — show regular forecast
  if (d.wind_speed == null) return null
  const items = []
  payload.forEach(p => {
    if (p.dataKey === 'wind_gusts')    items.push({ name: 'Gusts',         value: p.value, color: p.color, unit })
    if (p.dataKey === 'wind_speed')    items.push({ name: 'Wind Speed',    value: p.value, color: p.color, unit })
    // Skip precipitation for short-term precip points to avoid showing 0
    if (p.dataKey === 'precipitation' && p.value != null && d.short_term_precip == null) {
      items.push({ name: 'Precipitation', value: p.value, color: p.color, unit: 'mm' })
    }
  })
  return box(items.map(it => (
    <div key={it.name} style={{ color: T.text2, marginBottom: 2 }}>
      <span style={{ color: it.color }}>{it.name}:</span>{' '}
      <span style={{ color: T.text }}>{it.value} {it.unit ?? 'km/h'}</span>
    </div>
  )))
}

const SPEED_FACTOR = { 'km/h': 1, 'kt': 1 / 1.852, 'm/s': 1 / 3.6 }

const DASH = ['4 2','10 10','8 2 2 2','10 5 2 4','5 10 4 2']

function InfoSymbols({ info }) {
  const [openIdx, setOpenIdx] = useState(null)
  const rowRef = useRef(null)

  useEffect(() => {
    if (openIdx == null) return
    const h = (e) => { if (rowRef.current && !rowRef.current.contains(e.target)) setOpenIdx(null) }
    document.addEventListener('mousedown', h)
    document.addEventListener('touchstart', h)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('touchstart', h) }
  }, [openIdx])

  if (!info?.length) return null

  // Fix JSX-style style attrs in the HTML strings: style={{ color: '...' }} → style="color: ..."
  const fixHtml = (html) => html.replace(/style=\{\{\s*colors?:\s*'([^']+)'\s*\}\}/g, 'style="color:$1"')

  return (
    <div ref={rowRef} data-tutorial="pt-symbols" style={{ position: 'relative', marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {info.map(([img, _], i) => (
          <img
            key={i}
            src={`/symbols/${img}`}
            alt=""
            style={{ width: 'clamp(46px, 11.5vw, 64px)', height: 'clamp(46px, 11.5vw, 64px)', cursor: 'pointer', borderRadius: 6, opacity: 0.75, border: openIdx === i ? `2px solid ${T.border}` : '2px solid transparent' }}
            onClick={() => setOpenIdx(openIdx === i ? null : i)}
          />
        ))}
      </div>
      {openIdx != null && info[openIdx] && (
        <div style={{
          marginTop: 6, padding: '10px 14px',
          background: T.card, border: `1px solid ${T.border}`, borderRadius: 8,
          fontSize: fs(12), color: T.text2, lineHeight: 1.6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          <div dangerouslySetInnerHTML={{ __html: fixHtml(info[openIdx][1]) }} />
        </div>
      )}
    </div>
  )
}

export default function PointForecast({ data }) {
  const { rawForecast, displayForecast, points, measurements, wings, days, dateIdx, ptIdx, setPtIdx, speedUnit = 'km/h', altStationPrefs, setAltStationPrefs, effectiveTimeStart, effectiveTimeEnd } = data
  const isToday = days?.[dateIdx] === 'Today'
  const toUnit = (v) => v == null ? null : parseFloat((v * SPEED_FACTOR[speedUnit]).toFixed(1))

  const point = points[ptIdx]
  const dayFc = rawForecast?.[dateIdx]?.[ptIdx]

  const heading    = point?.heading ?? 0
  const head_range = point?.head_range
  const lowerIdeal = heading + (head_range?.good[0])
  const upperIdeal = heading + (head_range?.good[1])
  const lowerBound = heading + (head_range?.cross[0])
  const upperBound = heading + (head_range?.cross[1])
  const domainLow  = heading - 90
  const domainHigh = heading + 90

  // Determine which station to use for wind data based on alt_station preference
  const useAlt = altStationPrefs?.[ptIdx] && point?.alt_station
  const windStationRef = useAlt ? point.alt_station : point?.station
  // Heading always comes from the primary station
  const headingStationRef = point?.station

  // ── Effective time window as epoch ms (anchored to the forecast day) ─────
  const { winStartMs, winEndMs } = useMemo(() => {
    if (!dayFc?.time?.length) return { winStartMs: 0, winEndMs: 0 }
    // Derive the calendar date from the first forecast timestamp
    const refDate = new Date(dayFc.time[0])
    const [sh, sm] = (effectiveTimeStart || '00:00').split(':').map(Number)
    const [eh, em] = (effectiveTimeEnd   || '23:59').split(':').map(Number)
    const ws = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate(), sh, sm).getTime()
    let   we = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate(), eh, em).getTime()
    // 00:00 end means next-day midnight
    if (eh === 0 && em === 0) we += 24 * 60 * 60 * 1000
    return { winStartMs: ws, winEndMs: we }
  }, [dayFc, effectiveTimeStart, effectiveTimeEnd])

  // Filter dayFc to the effective time window
  const filteredDayFc = useMemo(() => {
    if (!dayFc?.time?.length) return dayFc
    const indices = []
    dayFc.time.forEach((t, i) => {
      const ms = new Date(t).getTime()
      if (ms >= winStartMs && ms <= winEndMs) indices.push(i)
    })
    if (indices.length === dayFc.time.length) return dayFc  // no filtering needed
    const pick = (arr) => indices.map(i => arr[i])
    return {
      ...dayFc,
      time:           pick(dayFc.time),
      temperature:    pick(dayFc.temperature),
      visibility:     pick(dayFc.visibility),
      precipitation:  pick(dayFc.precipitation),
      wind_speed:     pick(dayFc.wind_speed),
      wind_direction: pick(dayFc.wind_direction),
      wind_gusts:     pick(dayFc.wind_gusts),
    }
  }, [dayFc, winStartMs, winEndMs])

  // ── Short-term precipitation from measurements (server-cached nowcast) ───
  // Only show on "Today" and filter to the effective time window
  const shortTermPrecipRaw = isToday ? measurements?.short_term_precipitation?.[ptIdx] : null
  const shortTermPrecip = useMemo(() => {
    if (!shortTermPrecipRaw?.timestamps?.length) return null
    const ts = [], vs = []
    shortTermPrecipRaw.timestamps.forEach((t, i) => {
      const ms = new Date(t).getTime()
      if (ms >= winStartMs && ms <= winEndMs) { ts.push(t); vs.push(shortTermPrecipRaw.values[i]) }
    })
    return ts.length ? { timestamps: ts, values: vs } : null
  }, [shortTermPrecipRaw, winStartMs, winEndMs])

  // Use filteredDayFc for chart data — measurements also bounded by the window
  const windData = useMemo(() => {
    if (!filteredDayFc || !point) return []
    return buildWindData(filteredDayFc, measurements, windStationRef, toUnit, shortTermPrecip)
  }, [filteredDayFc, measurements, windStationRef, point, speedUnit, shortTermPrecip])

  const dirData  = useMemo(() => { if (!filteredDayFc||!point) return []; return buildDirData(filteredDayFc,measurements,headingStationRef,heading) }, [filteredDayFc,measurements,headingStationRef,point,heading])
  const tempData = useMemo(() => (!filteredDayFc||!point)?[]:buildTempData(filteredDayFc), [filteredDayFc,point])

  if (!point || !dayFc) return <div style={{ color: T.text2, padding: '40px 0', textAlign: 'center', fontSize: fs(13) }}>No data available for this selection.</div>

  const dispPf     = displayForecast?.[dateIdx]?.[ptIdx]
  const wind_ranges = dispPf?.wind_ranges ?? []

  return (
    <div>
      <div data-tutorial="pt-selectors">
        <select style={{ ...select_, marginBottom: 8 }} value={ptIdx} onChange={e => setPtIdx(Number(e.target.value))}>
          {points.map((p,i) => <option key={p.name} value={i}>{p.name}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
          <a href={`https://www.google.com/maps/place/${point.lat}N+${point.lon}E`}
            target="_blank" rel="noopener noreferrer"
            style={{ fontSize: fs(12), color: T.text2, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <img src="https://img.icons8.com/ios-filled/28/5e5e7a/marker.png" width={12} height={12} alt="" />
            Google Maps
          </a>
          {point.link && (
            <a href={point.link}
              target="_blank" rel="noopener noreferrer"
              style={{ fontSize: fs(12), color: T.text2, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <img src="https://img.icons8.com/ios-filled/28/5e5e7a/info.png" width={12} height={12} alt="" />
              Spot information
            </a>
          )}
        </div>
      </div>

      {/* Site info symbols */}
      <InfoSymbols info={point.info} />

      {/* Wind Speed */}
      <div data-tutorial="pt-wind" style={card_}>
        <div style={sectionTitle_}>Wind &amp; Gust Speed</div>
        <ResponsiveContainer width="100%" height={250}>
          <ComposedChart data={windData} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
            <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin','dataMax']} ticks={filteredDayFc.time.map(t => new Date(t).getTime())} tickFormatter={fmtTime} tick={TICK} />
            <YAxis yAxisId="wind" tick={TICK} width={30} />
            <YAxis yAxisId="rain" orientation="right" tick={false} width={1} />
            <Tooltip content={<WindTooltip unit={speedUnit} />} />
            <Legend wrapperStyle={{ fontSize:fsc(8, '1.4vw', 12), color: T.text2, fontFamily: T.font }} />
            {wind_ranges.map((wing, i) => {
              const dash = DASH[i % DASH.length]
              const displayName = wings[wing.key]?.display_name ?? wing.key
              const label = wing.key==='custom' ? 'Custom' : `${displayName} ${wing.size}`
              const [wMin, wMax] = wing.range
              const posMin = i%2===0 ? 'insideTopLeft' : 'insideTopRight'
              const posMax = i%2===0 ? 'insideBottomLeft' : 'insideBottomRight'
              return [
                <ReferenceLine key={`min-${wing.key}`} yAxisId="wind" y={toUnit(wMin)} stroke="#3aaa66" strokeWidth={1.5} strokeDasharray={dash} label={{ value:`↑ ${label} ↑`, fill:'#1fd100', fontSize:fs(8), position:posMin }} />,
                <ReferenceLine key={`max-${wing.key}`} yAxisId="wind" y={toUnit(wMax)} stroke="#3aaa80" strokeWidth={1.5} strokeDasharray={dash} label={{ value:`↓ ${label} ↓`, fill:'#6be655', fontSize:fs(8), position:posMax }} />,
              ]
            })}
            <Area yAxisId="wind" type="monotone" dataKey="wind_gusts"    name={`Gusts (${speedUnit})`}        fill="#c07028" stroke="#c07028" fillOpacity={0.25} dot={false} connectNulls />
            <Area yAxisId="wind" type="monotone" dataKey="wind_speed"    name={`Wind Speed (${speedUnit})`}   fill="#7aaaee" stroke="#7aaaee" fillOpacity={0.25} dot={false} connectNulls />
            <Area yAxisId="rain" type="monotone" dataKey="precipitation" name="Precipitation (mm)"             fill="#3a6bbf" stroke="#3a6bbf" fillOpacity={0.8}  dot={false} connectNulls />
            {shortTermPrecip?.timestamps?.length > 0 && (
              <Area yAxisId="rain" type="monotone" dataKey="short_term_precip" name="Short Term Precip. (mm/hr)" fill="#1b8fe2" stroke="#1b8fe2" fillOpacity={0.9} dot={false} connectNulls strokeWidth={1.5} />
            )}
            {/* Measurement band — stacked fill-between: min base (transparent) + band on top */}
            <Area yAxisId="wind" type="linear" dataKey="meas_wind_min"  name={`Measured (${speedUnit})`}   stackId="meas" stroke="rgba(255,255,255,0.75)" strokeWidth={1.5} fill="transparent" dot={false} connectNulls />
            <Area yAxisId="wind" type="linear" dataKey="meas_wind_band" name="Measured max"                 stackId="meas" stroke="rgba(255,255,255,0.75)" strokeWidth={1.5} fill="rgba(255,255,255,0.18)" fillOpacity={1} dot={false} connectNulls legendType="none" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Wind Direction */}
      <div data-tutorial="pt-direction" style={card_}>
        <div style={sectionTitle_}>Wind Heading</div>
        <ResponsiveContainer width="100%" height={210}>
          <ComposedChart data={dirData} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
            <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin','dataMax']} ticks={filteredDayFc.time.map(t => new Date(t).getTime())} tickFormatter={fmtTime} tick={TICK} />
            <YAxis tick={TICK} domain={[domainLow, domainHigh]} width={30} allowDataOverflow />
            <Tooltip {...TOOLTIP} />
            <Legend wrapperStyle={{ fontSize:fsc(8, '1.4vw', 12), color: T.text2, fontFamily: T.font }} />
            <ReferenceArea y1={lowerBound} y2={lowerIdeal} fill="#d27a2d" fillOpacity={0.45} />
            <ReferenceArea y1={lowerIdeal} y2={upperIdeal} fill="#25b863" fillOpacity={0.45} />
            <ReferenceArea y1={upperIdeal} y2={upperBound} fill="#d27a2d" fillOpacity={0.45} />
            <ReferenceLine y={heading} stroke={T.text3} strokeDasharray="4 2" label={{ value:`${heading}°`, fill: T.text3, fontSize:fs(11) }} />
            <Line type="monotone" dataKey="wind_dir" name="Forecast heading (°)" stroke="#aaaacc" dot={false} strokeWidth={2}   connectNulls />
            <Line type="linear"   dataKey="meas_dir" name="Measured heading (°)" stroke={T.text}    dot={false} strokeWidth={1.5} connectNulls strokeDasharray="5 3" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Temperature & Visibility */}
      <div style={card_}>
        <div style={sectionTitle_}>Temperature &amp; Visibility</div>
        <ResponsiveContainer width="100%" height={210}>
          <ComposedChart data={tempData} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
            <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin','dataMax']} tickFormatter={fmtTime} tick={TICK} />
            <YAxis yAxisId="temp" tick={{ ...TICK, fill: '#c09030' }} width={30} />
            <YAxis yAxisId="vis"  orientation="right" tick={TICK} width={24} />
            <Tooltip {...TOOLTIP} />
            <Legend wrapperStyle={{ fontSize:fsc(8, '1.4vw', 12), color: T.text2, fontFamily: T.font }} />
            <ReferenceLine yAxisId="vis" y={0.1} stroke="#c04040" strokeDasharray="4 2" label={{ value:'Min visibility', fill:'#c12e0d', fontSize:fs(11) }} />
            <Line yAxisId="temp" type="monotone" dataKey="temperature" name="Temp (°C)"       stroke="#c09030" dot={false} strokeWidth={2} />
            <Line yAxisId="vis"  type="monotone" dataKey="visibility"  name="Visibility (km)" stroke={T.text2} dot={false} strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div data-tutorial="pt-ranges">
      {/* Wind ranges */}
      {wind_ranges.length > 0 && (
        <div style={{ fontSize: fs(12), color: T.text2, marginTop: 4, lineHeight: 2 }}>
          <span style={{ color: T.text, fontWeight: 600 }}>Wind ranges at {point.name}:</span><br />
          {wind_ranges.map(wr => {
            const displayName = wings[wr.key]?.display_name ?? wr.key
            const [wMin, wMax] = wr.range
            return (
              <span key={wr.key} style={{ marginRight: 16 }}>
                <b style={{ color: T.text }}>{wr.key==='custom' ? 'Custom' : `${displayName} ${wr.size}m²`}</b>
                {': '}
                <span style={{ color: '#1fd100' }}>{Math.round(toUnit(wMin))}</span>
                {' – '}
                <span style={{ color: '#6be655' }}>{Math.round(toUnit(wMax))}</span>
                {` ${speedUnit}`}
              </span>
            )
          })}
        </div>
      )}

      {/* Station selector (radio-style) for locations with alt_station */}
      {point.alt_station && (() => {
        const [priApi, priCode] = point.station
        const [altApi, altCode] = point.alt_station
        const priStation = measurements?.[priApi]?.[priCode]
        const altStation = measurements?.[altApi]?.[altCode]
        const priLabel = priStation?.name || `${priApi.toUpperCase()} ${priCode}`
        const altLabel = altStation?.name || `${altApi.toUpperCase()} ${altCode}`
        const useAltChecked = !!altStationPrefs?.[ptIdx]
        const radioStyle = { width: 14, height: 14, cursor: 'pointer', accentColor: '#7aaaee', margin: 0 }
        return (
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: fs(13), color: useAltChecked ? T.text3 : T.text, cursor: 'pointer', userSelect: 'none' }}>
              <input type="radio" name={`station-${ptIdx}`} checked={!useAltChecked}
                onChange={() => setAltStationPrefs(prev => ({ ...prev, [ptIdx]: false }))}
                style={radioStyle} />
              {priLabel}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: fs(13), color: useAltChecked ? T.text : T.text3, cursor: 'pointer', userSelect: 'none' }}>
              <input type="radio" name={`station-${ptIdx}`} checked={useAltChecked}
                onChange={() => setAltStationPrefs(prev => ({ ...prev, [ptIdx]: true }))}
                style={radioStyle} />
              {altLabel}
            </label>
          </div>
        )
      })()}

      {/* Station info */}
      <div style={{ fontSize: fs(12), color: T.text2, marginTop: 12, lineHeight: 1.8 }}>
        {(() => {
          if (!windStationRef) return null
          const [api, code] = windStationRef
          const st = measurements?.[api]?.[code]
          if (!st) return null
          return (
            <>
              Wind station: <b style={{ color: T.text }}>{st.name}</b> ({api.toUpperCase()})
              {st.lat != null && <> — {st.lat.toFixed(3)}°N, {st.lon.toFixed(3)}°E</>}
              <br />
            </>
          )
        })()}
        {(() => {
          // Show heading station separately if it differs from wind station
          if (!headingStationRef || (windStationRef && headingStationRef[0] === windStationRef[0] && headingStationRef[1] === windStationRef[1])) return null
          const [api, code] = headingStationRef
          const st = measurements?.[api]?.[code]
          if (!st?.heading) return null
          return (
            <>
              Heading station: <b style={{ color: T.text }}>{st.name}</b> ({api.toUpperCase()})
              <br />
            </>
          )
        })()}
        {dayFc?.offshore_actual_lat != null
          ? <>Offshore forecast at <b style={{ color: T.text }}>{dayFc.offshore_actual_lat.toFixed(5)}°N, {dayFc.offshore_actual_lon.toFixed(5)}°E</b></>
          : 'Offshore forecast coordinates unavailable'
        }
        <br />
        {shortTermPrecipRaw?.timestamps?.length > 0
          ? <>Short-term precip. for this location ({shortTermPrecipRaw.timestamps.length} data points from {point.lat.toFixed(5)}°N, {point.lon.toFixed(5)}°E)</>
          : 'No short-term precipitation data available'
        }
      </div>
      </div>
    </div>
  )
}