import React, { useState, useMemo } from 'react'
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

  if (meas?.[station]?.WINDSHD) {
    const { timestamps, values } = meas[station].WINDSHD
    timestamps.forEach((ts, i) => {
      const t = new Date(ts)
      if (sunrise && t < new Date(sunrise)) return
      if (sunset  && t > new Date(sunset))  return
      points.push({ ts: t.getTime(), meas_wind: parseFloat(values[i]?.toFixed(1)) })
    })
  }

  return points.sort((a, b) => a.ts - b.ts)
}

function buildDirData(dayFc, meas, station, sunrise, sunset) {
  const points = dayFc.time.map((t, i) => ({
    ts: new Date(t).getTime(),
    wind_dir: parseFloat(dayFc.wind_direction[i]?.toFixed(1)),
  }))
  if (meas?.[station]?.WINDRTG) {
    const { timestamps, values } = meas[station].WINDRTG
    timestamps.forEach((ts, i) => {
      const t = new Date(ts)
      if (sunrise && t < new Date(sunrise)) return
      if (sunset  && t > new Date(sunset))  return
      points.push({ ts: t.getTime(), meas_dir: parseFloat(values[i]?.toFixed(1)) })
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
  const { rawForecast, displayForecast, points, measurements, dateIdx, model } = data
  const [ptIdx, setPtIdx] = useState(0)

  const point   = points[ptIdx]
  const dayFc   = rawForecast?.[dateIdx]?.[ptIdx]

  const windData = useMemo(() => {
    if (!dayFc || !point) return []
    return buildWindData(dayFc, measurements, point.station, dayFc.sunrise, dayFc.sunset)
  }, [dayFc, measurements, point])

  const dirData = useMemo(() => {
    if (!dayFc || !point) return []
    return buildDirData(dayFc, measurements, point.station, dayFc.sunrise, dayFc.sunset)
  }, [dayFc, measurements, point])

  const tempData = useMemo(() => {
    if (!dayFc || !point) return []
    return buildTempData(dayFc)
  }, [dayFc, point])

  if (!point || !dayFc) return <div style={{ color: '#888' }}>No data available for this selection.</div>

  const { heading, head_range } = point
  const lowerIdeal = heading + head_range.good[0]
  const upperIdeal = heading + head_range.good[1]
  const lowerBound = heading + head_range.cross[0]
  const upperBound = heading + head_range.cross[1]

  // Effective wind range pre-computed by the backend for the selected wings
  const dispPf   = displayForecast?.[dateIdx]?.[ptIdx]
  const wind_min = dispPf?.wind_min
  const wind_max = dispPf?.wind_max

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
        📍 Google Maps
      </a>

      {/* Wind Speed & Gusts */}
      <div style={card}>
        <div style={sectionTitle}>Wind Speed &amp; Gusts</div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={windData} margin={{ top: 4, right: 2, left: 2, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
            <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']}
              tickFormatter={fmtTime} tick={{ fill: '#888', fontSize: 11 }} />
            <YAxis yAxisId="wind" tick={{ fill: '#888', fontSize: 11 }} width={30} />
            <YAxis yAxisId="rain" orientation="right" tick={{ fill: '#5ab5f7', fontSize: 11 }} width={24} />
            <Tooltip {...TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 12, color: '#aaa' }} />

            {/* Flyable wind band — only shown when display forecast is loaded */}
            {wind_min != null && <ReferenceLine yAxisId="wind" y={wind_min} stroke="#1fd100" strokeWidth={2} strokeDasharray="4 2" label={{ value: `↑ ${Math.round(wind_min)} km/h`, fill: '#1fd100', fontSize: 10, position: 'insideTopLeft' }} />}
            {wind_max != null && <ReferenceLine yAxisId="wind" y={wind_max} stroke="#1fd100" strokeWidth={2} strokeDasharray="4 2" label={{ value: `↓ ${Math.round(wind_max)} km/h`, fill: '#1fd100', fontSize: 10, position: 'insideBottomLeft' }} />}

            <Area yAxisId="wind" type="monotone" dataKey="wind_gusts"    name="Gust Speed (km/h)"         fill="#d68800" stroke="#d68800" fillOpacity={0.3} dot={false} connectNulls />
            <Area yAxisId="wind" type="monotone" dataKey="wind_speed"    name="Wind Speed (km/h)"    fill="#7eb8f7" stroke="#7eb8f7" fillOpacity={0.3} dot={false} connectNulls />
            <Area yAxisId="rain" type="monotone" dataKey="precipitation" name="Precipitation (mm)"           fill="#5ab5f7" stroke="#5ab5f7" fillOpacity={1}   dot={false} connectNulls />
            <Scatter yAxisId="wind" dataKey="meas_wind" name="Measured wind spread (km/h)" fill="#ffffff" opacity={0.8}
              shape={(props) => <circle cx={props.cx} cy={props.cy} r={3} fill="#ffffff" opacity={0.8} />} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Wind Direction */}
      <div style={card}>
        <div style={sectionTitle}>Wind Direction</div>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={dirData} margin={{ top: 4, right: 2, left: 2, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
            <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']}
              tickFormatter={fmtTime} tick={{ fill: '#888', fontSize: 11 }} />
            <YAxis tick={{ fill: '#888', fontSize: 11 }} domain={[lowerBound - 20, upperBound + 20]} width={30} />
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

      {/* Station info */}
      {measurements?.[point.station] && (
        <div style={{ fontSize: 12, color: '#666', marginTop: 8, lineHeight: 1.7 }}>
          Weather station: <b style={{ color: '#aaa' }}>{measurements[point.station].name}</b>
          &nbsp;({measurements[point.station].lat?.toFixed(3)}°N, {measurements[point.station].lon?.toFixed(3)}°E)
          &nbsp;— Forecast point: {point.offshore_lat?.toFixed(5)}°N, {point.offshore_lon?.toFixed(5)}°E
        </div>
      )}
    </div>
  )
}