import React, { useMemo, useEffect } from 'react'
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
  font:      "'DM Sans', system-ui, sans-serif",
}

const card_ = { background: T.card, border: `1px solid ${T.borderDim}`, borderRadius: 8, padding: '14px 0', marginBottom: 16 }
const sectionTitle_ = { fontSize: 12, fontWeight: 600, color: T.text2, marginBottom: 12, paddingLeft: 14, letterSpacing: '0.04em', textTransform: 'uppercase' }
const select_ = { background: T.raised, color: T.text, border: `1px solid ${T.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 13, cursor: 'pointer', marginBottom: 14, fontFamily: T.font }
const TOOLTIP = { contentStyle: { background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 12, fontFamily: T.font }, labelStyle: { color: T.text2 }, labelFormatter: fmtTime }
const GRID_STROKE = '#2a2a2a'
const TICK  = { fill: T.text2, fontSize: 11, fontFamily: T.font }

function fmtTime(ms) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function buildWindData(dayFc, meas, station, sunrise, sunset) {
  const fcPoints = dayFc.time.map((t, i) => ({
    ts:            new Date(t).getTime(),
    wind_speed:    parseFloat(dayFc.wind_speed[i]?.toFixed(1)),
    wind_gusts:    parseFloat(dayFc.wind_gusts[i]?.toFixed(1)),
    precipitation: parseFloat(dayFc.precipitation[i]?.toFixed(2)),
  }))

  const ws = meas?.[station]?.WINDSHD
  if (!ws?.timestamps?.length || !ws?.values?.length) return fcPoints

  // Group readings by exact timestamp (multiple sensors share the same ts)
  const byTs = new Map()
  ws.timestamps.forEach((ts, i) => {
    const v = ws.values[i]; if (v==null||!isFinite(v)) return
    const t = new Date(ts); if (isNaN(t.getTime())) return
    if (sunrise && t < new Date(sunrise)) return
    if (sunset  && t > new Date(sunset))  return
    const key = t.getTime()
    if (!byTs.has(key)) byTs.set(key, [])
    byTs.get(key).push(parseFloat(v.toFixed(1)))
  })

  // For each measurement interval, build a point with min/max
  const measPoints = []
  byTs.forEach((vals, ts) => {
    measPoints.push({
      ts,
      meas_wind_min: Math.min(...vals),
      meas_wind_max: Math.max(...vals),
      meas_wind_count: vals.length,
    })
  })

  // Merge: attach measurement min/max onto any forecast point within 5 min
  const FIVE_MIN = 5 * 60 * 1000
  fcPoints.forEach(fp => {
    const near = measPoints.find(m => Math.abs(m.ts - fp.ts) <= FIVE_MIN)
    if (near) {
      fp.meas_wind_min   = near.meas_wind_min
      fp.meas_wind_max   = near.meas_wind_max
      fp.meas_wind_count = near.meas_wind_count
    }
  })

  // Add band field (max - min) for stacked fill-between rendering
  measPoints.forEach(m => { m.meas_wind_band = parseFloat((m.meas_wind_max - m.meas_wind_min).toFixed(1)) })
  fcPoints.forEach(fp => {
    if (fp.meas_wind_min != null) fp.meas_wind_band = parseFloat((fp.meas_wind_max - fp.meas_wind_min).toFixed(1))
  })

  // Combine and sort; measurement-only points (between forecast hours) keep null forecast fields
  return [...fcPoints, ...measPoints].sort((a, b) => a.ts - b.ts)
}

function buildDirData(dayFc, meas, station, sunrise, sunset, heading) {
  function norm(deg) {
    let d = deg - heading
    if (d >  180) d -= 360
    if (d < -180) d += 360
    return heading + d
  }
  const rawDirs = dayFc.time.map((_, i) => dayFc.wind_direction[i])
  const unwrapped = rawDirs.map(v => norm(v))
  const points = dayFc.time.map((t, i) => ({ ts: new Date(t).getTime(), wind_dir: parseFloat(unwrapped[i].toFixed(1)) }))
  const ds = meas?.[station]?.WINDRTG
  if (ds?.timestamps?.length && ds?.values?.length) {
    ds.timestamps.forEach((ts, i) => {
      const v = ds.values[i]; if (v==null||!isFinite(v)) return
      const t = new Date(ts); if (isNaN(t.getTime())) return
      if (sunrise && t < new Date(sunrise)) return
      if (sunset  && t > new Date(sunset))  return
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

function WindTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload ?? {}

  const box = (children) => (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, padding: '8px 10px', fontSize: 12, fontFamily: T.font }}>
      <div style={{ color: T.text2, marginBottom: 6 }}>{fmtTime(label)}</div>
      {children}
    </div>
  )

  // If measurement data exists at this point, show that instead of forecast
  if (d.meas_wind_min != null) {
    return box(
      <div style={{ color: T.text2 }}>
        <div style={{ color: 'rgba(255,255,255,0.8)', marginBottom: 3 }}>Measured wind</div>
        <div>max: <span style={{ color: T.text }}>{d.meas_wind_max} km/h</span></div>
        <div>min: <span style={{ color: T.text }}>{d.meas_wind_min} km/h</span></div>
      </div>
    )
  }

  // No measurement — show forecast
  if (d.wind_speed == null) return null
  const items = []
  payload.forEach(p => {
    if (p.dataKey === 'wind_gusts')    items.push({ name: 'Gusts',         value: p.value, color: p.color })
    if (p.dataKey === 'wind_speed')    items.push({ name: 'Wind Speed',    value: p.value, color: p.color })
    if (p.dataKey === 'precipitation') items.push({ name: 'Precipitation', value: p.value, color: p.color, unit: 'mm' })
  })
  return box(items.map(it => (
    <div key={it.name} style={{ color: T.text2, marginBottom: 2 }}>
      <span style={{ color: it.color }}>{it.name}:</span>{' '}
      <span style={{ color: T.text }}>{it.value} {it.unit ?? 'km/h'}</span>
    </div>
  )))
}

const DASH = ['4 2','10 10','8 2 2 2','10 5 2 4','5 10 4 2']

export default function PointForecast({ data }) {
  const { rawForecast, displayForecast, points, measurements, wings, dateIdx, ptIdx, setPtIdx } = data

  const point = points[ptIdx]
  const dayFc = rawForecast?.[dateIdx]?.[ptIdx]

  useEffect(() => {
    if (!displayForecast) return
    const dayPf = displayForecast[dateIdx] || []
    let bestQuality = -1
    dayPf.forEach(pf => { const q = pf.good_hours+pf.gusty_hours; if(q>bestQuality) bestQuality=q })
    let best=0, bestFly=-1
    dayPf.forEach((pf,pi) => {
      const q=pf.good_hours+pf.gusty_hours
      const f=pf.good_hours+pf.cross_hours+pf.gusty_hours+pf.cross_gusty_hours
      if(q===bestQuality&&f>bestFly){bestFly=f;best=pi}
    })
    setPtIdx(best)
  }, [dateIdx, displayForecast])

  const heading    = point?.heading ?? 0
  const head_range = point?.head_range
  const lowerIdeal = heading + (head_range?.good[0])
  const upperIdeal = heading + (head_range?.good[1])
  const lowerBound = heading + (head_range?.cross[0])
  const upperBound = heading + (head_range?.cross[1])
  const domainLow  = heading - 90
  const domainHigh = heading + 90

  const windData = useMemo(() => (!dayFc||!point)?[]:buildWindData(dayFc,measurements,point.station,dayFc.sunrise,dayFc.sunset), [dayFc,measurements,point])
  const dirData  = useMemo(() => (!dayFc||!point)?[]:buildDirData(dayFc,measurements,point.station,dayFc.sunrise,dayFc.sunset,heading), [dayFc,measurements,point,heading])
  const tempData = useMemo(() => (!dayFc||!point)?[]:buildTempData(dayFc), [dayFc,point])

  if (!point || !dayFc) return <div style={{ color: T.text2, padding: '40px 0', textAlign: 'center', fontSize: 13 }}>No data available for this selection.</div>

  const dispPf     = displayForecast?.[dateIdx]?.[ptIdx]
  const wind_ranges = dispPf?.wind_ranges ?? {}

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <select style={select_} value={ptIdx} onChange={e => setPtIdx(Number(e.target.value))}>
          {points.map((p,i) => <option key={p.name} value={i}>{p.name}</option>)}
        </select>
        <a href={`https://www.google.com/maps/place/${point.lat}N+${point.lon}E`}
          target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 12, color: T.text2, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 14 }}
        >
          <img src="https://img.icons8.com/ios-filled/28/5e5e7a/marker.png" width={12} height={12} alt="" />
          Google Maps
        </a>
      </div>

      {/* Wind Speed */}
      <div style={card_}>
        <div style={sectionTitle_}>Wind &amp; Gust Speed</div>
        <ResponsiveContainer width="100%" height={250}>
          <ComposedChart data={windData} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
            <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin','dataMax']} ticks={dayFc.time.map(t => new Date(t).getTime())} tickFormatter={fmtTime} tick={TICK} />
            <YAxis yAxisId="wind" tick={TICK} width={30} />
            <YAxis yAxisId="rain" orientation="right" tick={false} width={1} />
            <Tooltip content={<WindTooltip />} />
            <Legend wrapperStyle={{ fontSize:"clamp(8px, 1.4vw, 12px)", color: T.text2, fontFamily: T.font }} />
            {wind_ranges.map((wing, i) => {
              const dash = DASH[i % DASH.length]
              const displayName = wings[wing.key]?.display_name ?? wing.key
              const label = wing.key==='custom' ? 'Custom' : `${displayName} ${wing.size}`
              const [wMin, wMax] = wing.range
              const posMin = i%2===0 ? 'insideTopLeft' : 'insideTopRight'
              const posMax = i%2===0 ? 'insideBottomLeft' : 'insideBottomRight'
              return [
                <ReferenceLine key={`min-${wing.key}`} yAxisId="wind" y={wMin} stroke="#3aaa66" strokeWidth={1.5} strokeDasharray={dash} label={{ value:`↑ ${label} ↑`, fill:'#1fd100', fontSize:8, position:posMin }} />,
                <ReferenceLine key={`max-${wing.key}`} yAxisId="wind" y={wMax} stroke="#3aaa80" strokeWidth={1.5} strokeDasharray={dash} label={{ value:`↓ ${label} ↓`, fill:'#6be655', fontSize:8, position:posMax }} />,
              ]
            })}
            <Area yAxisId="wind" type="monotone" dataKey="wind_gusts"    name="Gusts (km/h)"       fill="#c07028" stroke="#c07028" fillOpacity={0.25} dot={false} connectNulls />
            <Area yAxisId="wind" type="monotone" dataKey="wind_speed"    name="Wind Speed (km/h)"  fill="#7aaaee" stroke="#7aaaee" fillOpacity={0.25} dot={false} connectNulls />
            <Area yAxisId="rain" type="monotone" dataKey="precipitation" name="Precipitation (mm)" fill="#3a6bbf" stroke="#3a6bbf" fillOpacity={0.9}  dot={false} connectNulls />
            {/* Measurement band — stacked fill-between: min base (transparent) + band on top */}
            <Area yAxisId="wind" type="linear" dataKey="meas_wind_min"  name="Measured wind (km/h)" stackId="meas" stroke="rgba(255,255,255,0.75)" strokeWidth={1.5} fill="transparent" dot={false} connectNulls />
            <Area yAxisId="wind" type="linear" dataKey="meas_wind_band" name="Measured wind max"     stackId="meas" stroke="rgba(255,255,255,0.75)" strokeWidth={1.5} fill="rgba(255,255,255,0.18)" fillOpacity={1} dot={false} connectNulls legendType="none" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Wind Direction */}
      <div style={card_}>
        <div style={sectionTitle_}>Wind Heading</div>
        <ResponsiveContainer width="100%" height={210}>
          <ComposedChart data={dirData} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
            <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin','dataMax']} tickFormatter={fmtTime} tick={TICK} />
            <YAxis tick={TICK} domain={[domainLow, domainHigh]} width={30} allowDataOverflow />
            <Tooltip {...TOOLTIP} />
            <Legend wrapperStyle={{ fontSize:"clamp(8px, 1.4vw, 12px)", color: T.text2, fontFamily: T.font }} />
            <ReferenceArea y1={lowerBound} y2={lowerIdeal} fill="#d27a2d" fillOpacity={0.45} />
            <ReferenceArea y1={lowerIdeal} y2={upperIdeal} fill="#25b863" fillOpacity={0.45} />
            <ReferenceArea y1={upperIdeal} y2={upperBound} fill="#d27a2d" fillOpacity={0.45} />
            <ReferenceLine y={heading} stroke={T.text3} strokeDasharray="4 2" label={{ value:`${heading}°`, fill: T.text3, fontSize:11 }} />
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
            <Legend wrapperStyle={{ fontSize:"clamp(8px, 1.4vw, 12px)", color: T.text2, fontFamily: T.font }} />
            <ReferenceLine yAxisId="vis" y={0.1} stroke="#c04040" strokeDasharray="4 2" label={{ value:'Min visibility', fill:'#c12e0d', fontSize:11 }} />
            <Line yAxisId="temp" type="monotone" dataKey="temperature" name="Temp (°C)"       stroke="#c09030" dot={false} strokeWidth={2} />
            <Line yAxisId="vis"  type="monotone" dataKey="visibility"  name="Visibility (km)" stroke={T.text2} dot={false} strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Wind ranges */}
      {wind_ranges.length > 0 && (
        <div style={{ fontSize: 12, color: T.text2, marginTop: 4, lineHeight: 2 }}>
          <span style={{ color: T.text, fontWeight: 600 }}>Wind ranges at {point.name}:</span><br />
          {wind_ranges.map(wr => {
            const displayName = wings[wr.key]?.display_name ?? wr.key
            const [wMin, wMax] = wr.range
            return (
              <span key={wr.key} style={{ marginRight: 16 }}>
                <b style={{ color: T.text }}>{wr.key==='custom' ? 'Custom' : `${displayName} ${wr.size}m²`}</b>
                {': '}
                <span style={{ color: '#1fd100' }}>{Math.round(wMin)}</span>
                {' – '}
                <span style={{ color: '#6be655' }}>{Math.round(wMax)}</span>
                {' km/h'}
              </span>
            )
          })}
        </div>
      )}

      {/* Station info */}
      {measurements?.[point.station] && (
        <div style={{ fontSize: 12, color: T.text2, marginTop: 12, lineHeight: 1.8 }}>
          Station: <b style={{ color: T.text }}>{measurements[point.station].name}</b>
          {' '}({measurements[point.station].lat?.toFixed(3)}°N, {measurements[point.station].lon?.toFixed(3)}°E)
          <br />
          Offshore forecast at {point.offshore_lat?.toFixed(5)}°N, {point.offshore_lon?.toFixed(5)}°E
          {dayFc?.offshore_actual_lat != null && (
            <> · API returned <b style={{ color: T.text }}>{dayFc.offshore_actual_lat.toFixed(5)}°N, {dayFc.offshore_actual_lon.toFixed(5)}°E</b></>
          )}
        </div>
      )}
    </div>
  )
}