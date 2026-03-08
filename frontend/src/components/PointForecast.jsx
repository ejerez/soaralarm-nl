import React, { useState, useMemo, useEffect } from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis, Scatter,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
  ReferenceArea,
} from 'recharts'

const card = {
  background: '#1e1e2e',
  border: '1px solid #2a2a3e',
  borderRadius: 8,
  padding: '12px 0',
  marginBottom: 20,
}

const sectionTitle = {
  fontSize: 15,
  fontWeight: 600,
  color: '#ccc',
  marginBottom: 12,
  paddingLeft: 12,
}

const select = {
  background: '#2a2a3e',
  color: '#e0e0e0',
  border: '1px solid #3a3a5e',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 14,
  cursor: 'pointer',
  marginBottom: 16,
}

const TOOLTIP_STYLE = {
  contentStyle: { background: '#1e1e2e', border: '1px solid #3a3a5e', borderRadius: 6, fontSize: 12 },
  labelStyle: { color: '#ccc' },
}

function fmtTime(ms) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Merge forecast array + measurement series into recharts data
// Each point has a numeric `ts` (ms since epoch) used as the X axis value.
function buildWindData(dayFc, meas, station, sunrise, sunset) {
  const points = dayFc.time.map((t, i) => ({
    ts: new Date(t).getTime(),
    wind_speed:    parseFloat(dayFc.wind_speed[i]?.toFixed(1)),
    wind_gusts:    parseFloat(dayFc.wind_gusts[i]?.toFixed(1)),
    precipitation: parseFloat(dayFc.precipitation[i]?.toFixed(2)),
  }))

  const windSeries = meas?.[station]?.WINDSHD
  if (windSeries?.timestamps?.length && windSeries?.values?.length) {
    const { timestamps, values } = windSeries
    timestamps.forEach((ts, i) => {
      const v = values[i]
      if (v == null || !isFinite(v)) return
      const t = new Date(ts)
      if (isNaN(t.getTime())) return
      if (sunrise && t < new Date(sunrise)) return
      if (sunset  && t > new Date(sunset))  return
      points.push({ ts: t.getTime(), meas_wind: parseFloat(v.toFixed(1)) })
    })
  }

  return points.sort((a, b) => a.ts - b.ts)
}

function buildDirData(dayFc, meas, station, sunrise, sunset, heading) {
  // Normalise a single value to be within [-180, +180] of heading
  function normToHeading(deg) {
    let d = deg - heading
    if (d > 180){
      d = d - 360
    }
    if (d < -180){
      d = d + 360
    }
    return heading + d
  }

  // Make a series continuous by minimising jumps between consecutive values
  function unwrap(values) {
    if (!values.length) return values
    const out = [normToHeading(values[0])]
    for (let i = 1; i < values.length; i++) {
      out.push(normToHeading(values[i]))
    }
    return out
  }

  const rawDirs = dayFc.time.map((_, i) => dayFc.wind_direction[i])
  const unwrapped = unwrap(rawDirs)

  const points = dayFc.time.map((t, i) => ({
    ts: new Date(t).getTime(),
    wind_dir: parseFloat(unwrapped[i].toFixed(1)),
  }))
  const dirSeries = meas?.[station]?.WINDRTG
  if (dirSeries?.timestamps?.length && dirSeries?.values?.length) {
    const { timestamps, values } = dirSeries
    timestamps.forEach((ts, i) => {
      const v = values[i]
      if (v == null || !isFinite(v)) return
      const t = new Date(ts)
      if (isNaN(t.getTime())) return
      if (sunrise && t < new Date(sunrise)) return
      if (sunset  && t > new Date(sunset))  return
      points.push({ ts: t.getTime(), meas_dir: parseFloat(normToHeading(v).toFixed(1)) })
    })
  }
  return points.sort((a, b) => a.ts - b.ts)
}

function buildTempData(dayFc) {
  return dayFc.time.map((t, i) => ({
    ts: new Date(t).getTime(),
    temperature: parseFloat(dayFc.temperature[i]?.toFixed(1)),
    visibility:  parseFloat((dayFc.visibility[i] / 1000)?.toFixed(2)),  // → km
  }))
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PointForecast({ data }) {
  const { rawForecast, displayForecast, points, measurements, wings, dateIdx, model, certainty } = data
  const [ptIdx, setPtIdx] = useState(0)

  const point   = points[ptIdx]
  const dayFc   = rawForecast?.[dateIdx]?.[ptIdx]

  // Default to the best point for the selected day.
  // Prefers the point with the highest multi-model confidence (best_pi from backend),
  // falling back to the selected model's flyable hours when certainty isn't ready.
  useEffect(() => {
    if (!displayForecast) return
    if (certainty?.[dateIdx]?.best_pi != null) {
      setPtIdx(certainty[dateIdx].best_pi)
      return
    }
    const dayPf = displayForecast[dateIdx] || []
    let bestFly = 0
    dayPf.forEach((pf) => {
      const fly = pf.good_hours + pf.cross_hours + pf.gusty_hours + pf.cross_gusty_hours
      if (fly > bestFly) bestFly = fly
    })
    let best = 0, bestGood = -1
    dayPf.forEach((pf, pi) => {
      const fly = pf.good_hours + pf.cross_hours + pf.gusty_hours + pf.cross_gusty_hours
      if (fly === bestFly && pf.good_hours > bestGood) { bestGood = pf.good_hours; best = pi }
    })
    setPtIdx(best)
  }, [dateIdx, displayForecast, certainty])

  // Compute heading bounds early so dirData memo can use them
  const heading    = point?.heading ?? 0
  const head_range = point?.head_range
  const lowerIdeal = heading + (head_range?.good[0])
  const upperIdeal = heading + (head_range?.good[1])
  const lowerBound = heading + (head_range?.cross[0])
  const upperBound = heading + (head_range?.cross[1])
  const domainLow  = heading - 90
  const domainHigh = heading + 90

  const windData = useMemo(() => {
    if (!dayFc || !point) return []
    return buildWindData(dayFc, measurements, point.station, dayFc.sunrise, dayFc.sunset)
  }, [dayFc, measurements, point])

  const dirData = useMemo(() => {
    if (!dayFc || !point) return []
    return buildDirData(dayFc, measurements, point.station, dayFc.sunrise, dayFc.sunset, heading)
  }, [dayFc, measurements, point, heading])

  const tempData = useMemo(() => {
    if (!dayFc || !point) return []
    return buildTempData(dayFc)
  }, [dayFc, point])

  if (!point || !dayFc) return <div style={{ color: '#888' }}>No data available for this selection.</div>

  // Per-wing speed ranges pre-computed by the backend
  const dispPf     = displayForecast?.[dateIdx]?.[ptIdx]
  const wind_ranges = dispPf?.wind_ranges ?? {}

  // Dash patterns cycling per wing so each is visually distinct
  const DASH_PATTERNS = ['4 2', '10 10', '8 2 2 2', '10 5 2 4', '5 10 4 2']

  return (
    <div>
      {/* Point selector */}
      <select style={select} value={ptIdx} onChange={e => setPtIdx(Number(e.target.value))}>
        {points.map((p, i) => <option key={p.name} value={i}>{p.name}</option>)}
      </select>

      {/* Google Maps link */}
      <a
        href={`https://www.google.com/maps/place/${point.lat}N+${point.lon}E`}
        target="_blank" rel="noopener noreferrer"
        style={{ display: 'inline-block', marginBottom: 16, marginLeft: 12, fontSize: 13, color: '#7eb8f7', textDecoration: 'none' }}
      >
        📍 Location
      </a>

      {/* Wind Speed & Gusts */}
      <div style={card}>
        <div style={sectionTitle}>Wind &amp; Gust Speed</div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={windData} margin={{ top: 4, right: 2, left: 2, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
            <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']}
              tickFormatter={fmtTime} tick={{ fill: '#888', fontSize: 11 }} />
            <YAxis yAxisId="wind" tick={{ fill: '#888', fontSize: 11 }} width={30} />
            <YAxis yAxisId="rain" orientation="right" tick={{ fill: '#5ab5f7', fontSize: 11 }} width={24} />
            <Tooltip {...TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 12, color: '#aaa' }} />

            {/* Per-wing speed bands */}
            {wind_ranges.map((wing, i) => {
              const dash        = DASH_PATTERNS[i % DASH_PATTERNS.length]
              const displayName = wings[wing.key]?.display_name ?? wing.key
              const isCustom    = wing.key === 'custom'
              const label       = isCustom ? 'Custom' : `${displayName} ${wing.size}`
              const [wMin, wMax] = wing.range
              const pos_min = (i % 2 == 0) ? 'insideTopLeft' : 'insideTopRight'
              const pos_max = (i % 2 == 0) ? 'insideBottomLeft' : 'insideBottomRight'
              return [
                <ReferenceLine key={`min-${wing.key}`} yAxisId="wind" y={wMin}
                  stroke="#6be655" strokeWidth={1.5} strokeDasharray={dash}
                  label={{ value: `↑ ${label} ↑`, fill: '#6be655', fontSize: 8, position: pos_min }} />,
                <ReferenceLine key={`max-${wing.key}`} yAxisId="wind" y={wMax}
                  stroke="#55e68f" strokeWidth={1.5} strokeDasharray={dash}
                  label={{ value: `↓ ${label} ↓`, fill: '#55e68f', fontSize: 8, position: pos_max }} />,
              ]
            })}

            <Area yAxisId="wind" type="monotone" dataKey="wind_gusts"    name="Gust Speed (km/h)"         fill="#d68800" stroke="#d68800" fillOpacity={0.3} dot={false} connectNulls />
            <Area yAxisId="wind" type="monotone" dataKey="wind_speed"    name="Wind Speed (km/h)"    fill="#a0ccfc" stroke="#a0ccfc" fillOpacity={0.3} dot={false} connectNulls />
            <Area yAxisId="rain" type="monotone" dataKey="precipitation" name="Precipitation (mm)"           fill="#1b8fe2" stroke="#1b8fe2" fillOpacity={1}   dot={false} connectNulls />
            <Scatter yAxisId="wind" dataKey="meas_wind" name="Measured wind spread (km/h)" fill="#ffffff" opacity={0.1}
              shape={(props) => {
                if (props.meas_wind == null || !isFinite(props.cy)) return null
                return <circle cx={props.cx} cy={props.cy} r={3} fill="#ffffff" opacity={0.8} />
              }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Wind Direction */}
      <div style={card}>
        <div style={sectionTitle}>Wind Heading</div>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={dirData} margin={{ top: 4, right: 2, left: 2, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
            <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']}
              tickFormatter={fmtTime} tick={{ fill: '#888', fontSize: 11 }} />
            <YAxis tick={{ fill: '#888', fontSize: 11 }} domain={[domainLow, domainHigh]} width={30} allowDataOverflow />
            <Tooltip {...TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 12, color: '#aaa' }} />

            {/* Heading zones */}
            <ReferenceArea y1={lowerBound}  y2={lowerIdeal}  fill="#d68800" fillOpacity={0.35} />
            <ReferenceArea y1={lowerIdeal}  y2={upperIdeal}  fill="#1fd100" fillOpacity={0.4} />
            <ReferenceArea y1={upperIdeal}  y2={upperBound}  fill="#d68800" fillOpacity={0.35} />
            <ReferenceLine y={heading} stroke="#666" strokeDasharray="4 2"
              label={{ value: `${heading}°`, fill: '#666', fontSize: 11 }} />

            <Line type="monotone" dataKey="wind_dir" name="Forecasted heading (°)" stroke="#ccc"    dot={false} strokeWidth={2}   connectNulls />
            <Line type="linear"   dataKey="meas_dir" name="Measured heading (°)" stroke="#ffffff" dot={false} strokeWidth={1.5} connectNulls strokeDasharray="5 3" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Temperature & Visibility */}
      <div style={card}>
        <div style={sectionTitle}>Temperature &amp; Visibility</div>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={tempData} margin={{ top: 4, right: 2, left: 2, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
            <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']}
              tickFormatter={fmtTime} tick={{ fill: '#888', fontSize: 11 }} />
            <YAxis yAxisId="temp" tick={{ fill: '#f5a623', fontSize: 11 }} width={30} />
            <YAxis yAxisId="vis" orientation="right" tick={{ fill: '#aaa', fontSize: 11 }} width={24} />
            <Tooltip {...TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 12, color: '#aaa' }} />
            <ReferenceLine yAxisId="vis" y={0.1} stroke="#e05c5c" strokeDasharray="4 2"
              label={{ value: 'Min visibility', fill: '#e05c5c', fontSize: 11 }} />
            <Line yAxisId="temp" type="monotone" dataKey="temperature" name="Temp (°C)"  stroke="#f5a623" dot={false} strokeWidth={2} />
            <Line yAxisId="vis"  type="monotone" dataKey="visibility"  name="Visibility (km)" stroke="#ccc" dot={false} strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Wing wind ranges */}
      {wind_ranges.length > 0 && (
        <div style={{ fontSize: 12, color: '#666', marginTop: 8, lineHeight: 2 }}>
          <span style={{ color: '#aaa', fontWeight: 650 }}>Wind ranges at {point.name}:</span><br />
          {wind_ranges.map(wr => {
            const displayName = wings[wr.key]?.display_name ?? wr.key
            const isCustom    = wr.key === 'custom'
            const [wMin, wMax] = wr.range
            return (
              <span key={wr.key} style={{ marginRight: 16 }}>
                <b style={{ color: '#aaa' }}>{isCustom ? 'Custom' : `${displayName} ${wr.size}m²`}</b>
                {': '}
                <span style={{ color: '#6be655' }}>{Math.round(wMin)}</span>
                {' – '}
                <span style={{ color: '#55e68f' }}>{Math.round(wMax)}</span>
                {' km/h'}
              </span>
            )
          })}
        </div>
      )}

      {/* Station info */}
      {measurements?.[point.station] && (
        <div style={{ fontSize: 12, color: '#666', marginTop: 8, lineHeight: 1.7 }}>
          Weather station: <b style={{ color: '#aaa' }}>{measurements[point.station].name}</b>
          &nbsp;({measurements[point.station].lat?.toFixed(3)}°N, {measurements[point.station].lon?.toFixed(3)}°E)
          <br />
          Offshore wind forecast requested at {point.offshore_lat?.toFixed(5)}°N, {point.offshore_lon?.toFixed(5)}°E <br />
          {dayFc?.offshore_actual_lat != null && <span> Open-Meteo API returned forecast at <b style={{ color: '#aaa' }}>{dayFc.offshore_actual_lat.toFixed(5)}°N, {dayFc.offshore_actual_lon.toFixed(5)}°E</b></span>}
        </div>
      )}
    </div>
  )
}