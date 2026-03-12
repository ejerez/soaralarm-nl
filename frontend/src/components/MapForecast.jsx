import React, { useEffect, useRef, useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, LabelList } from 'recharts'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const DEG = Math.PI / 180
function toRad(d) { return d * DEG }

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  bg:        '#1a1a1a',
  surface:   '#262626',
  card:      '#262626',
  raised:    '#2e2e2e',
  borderDim: '#353535',
  border:    '#3d3d3d',
  text:      '#dedede',
  text2:     '#9a9a9a',
  text3:     '#757575',
  font:      "'DM Sans', system-ui, sans-serif",
}
// Flyable colours — slightly desaturated for a more refined look
const C = {
  good:        '#1dbb02',
  cross:       '#d1bb16',
  gusty:       '#d68800',
  crossGusty:  '#c12e0d',
  rain:        '#1b8fe2',
  fog:         '#8888a0',
}

function windPolygons(point, pf) {
  const head      = toRad(point.heading)
  const good      = point.head_range.good
  const cross     = point.head_range.cross
  const relBounds = [cross[0], good[0], good[1], cross[1]]
  const slices    = pf.wind_pizza
  return relBounds.slice(0, 3).map((_, i) => {
    const ang1 = head + toRad(relBounds[i])
    const ang2 = head + toRad(relBounds[i + 1])
    const mag  = Math.min(slices[i], 3) * 0.04
    if (mag === 0) return null
    return {
      coords: [
        [point.lat, point.lon],
        [point.lat + mag * Math.cos(ang1), point.lon + 1.63 * mag * Math.sin(ang1)],
        [point.lat + mag * Math.cos(ang2), point.lon + 1.63 * mag * Math.sin(ang2)],
      ],
      color: i === 1 ? C.good : C.gusty,
    }
  }).filter(Boolean)
}

function markerColor(pf) {
  if (pf.good_hours > 0) return C.good
  if (pf.cross_hours > 0) return C.cross
  if (pf.gusty_hours > 0 || pf.cross_gusty_hours > 0) return C.crossGusty
  return '#333'
}

export function certLabel(agree, total) {
  if (agree === 4) return { label: 'Very High Confidence', color: '#00e6bc' }
  if (agree === 3) return { label: 'High Confidence',      color: '#8fef00' }
  if (agree === 2) return { label: 'Medium Confidence',    color: '#ffa726' }
  return                  { label: 'Low Confidence',       color: '#ef5350' }
}

function InfoTooltip({ text }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    document.addEventListener('touchstart', h)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('touchstart', h) }
  }, [open])
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block', verticalAlign: 'middle', marginLeft: 5 }}>
      <button onClick={() => setOpen(o => !o)} aria-label="Info" style={{
        background: open ? T.raised : 'transparent',
        color: open ? '#8888cc' : T.text3,
        border: `1px solid ${T.border}`,
        borderRadius: '50%',
        width: 16, height: 16,
        fontSize: 10, lineHeight: 1,
        cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        padding: 0,
      }}>ⓘ</button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: '50%',
          transform: 'translateX(-50%)', width: 280,
          background: T.card, border: `1px solid ${T.border}`,
          borderRadius: 6, padding: '8px 12px',
          fontSize: 12, color: T.text2, lineHeight: 1.55, zIndex: 100,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          {text}
        </div>
      )}
    </span>
  )
}

function GanttChart({ ganttRows, weatherRows, days, certByDay }) {
  const COLOR         = { good: C.good, cross: C.cross, good_gusty: C.gusty, cross_gusty: C.crossGusty, no: 'transparent' }
  const WEATHER_COLOR = { fog: C.fog, rain: C.rain }
  const DAY_H = 52, LEFT = 90, RIGHT = 20, W = 700

  const allTimes = ganttRows.flatMap(r => [new Date(r.start), new Date(r.end)])
  const minT = allTimes.length ? Math.min(...allTimes.map(t => t.getTime())) : 0
  const maxT = allTimes.length ? Math.max(...allTimes.map(t => t.getTime())) : 1
  const span = maxT - minT || 1
  const scale = (t) => LEFT + ((new Date(t).getTime() - minT) / span) * (W - LEFT - RIGHT)

  const grouped = {}
  for (const r of ganttRows) { if (!grouped[r.day]) grouped[r.day] = []; grouped[r.day].push(r) }
  const weatherGrouped = {}
  for (const r of (weatherRows || [])) { if (!weatherGrouped[r.day]) weatherGrouped[r.day] = []; weatherGrouped[r.day].push(r) }
  const dayKeys = [...new Set(ganttRows.map(r => r.day))]

  const svgH = dayKeys.length * DAY_H + 30
  const hourLabels = []
  if (minT && maxT) {
    const start = new Date(minT); start.setMinutes(0, 0, 0)
    for (let t = start.getTime(); t <= maxT; t += 3600_000) {
      const x = scale(new Date(t))
      if (x > LEFT && x < W - RIGHT) hourLabels.push({ x, label: new Date(t).getHours() + ':00' })
    }
  }

  return (
    <svg width="100%" viewBox={`0 0 ${W + 120} ${svgH}`} style={{ fontFamily: T.font }}>
      {hourLabels.map(h => (
        <g key={h.label + h.x}>
          <line x1={h.x} y1={20} x2={h.x} y2={svgH} stroke="#2a2a2a" strokeWidth={0.5} />
          <text x={h.x} y={14} fontSize={9} fill={T.text3} textAnchor="middle">{h.label}</text>
        </g>
      ))}
      {dayKeys.map((day, di) => {
        const y    = 20 + di * DAY_H
        const rows = grouped[day] || []
        const flyableRows = rows.filter(r => r.type !== 'no')
        const pointName   = flyableRows.length > 0 ? rows[0].point : null
        const wRows = weatherGrouped[day] || []
        return (
          <g key={day}>
            <text x={LEFT - 5} y={y + DAY_H / 2} fontSize={11} fill={T.text2} textAnchor="end">{day}</text>
            {pointName && (
              <text x={LEFT - 5} y={y + DAY_H / 2 + 13} fontSize="clamp(8px, 1.4vw, 10px)" fill={T.text3} textAnchor="end" fontStyle="italic">
                {pointName}
              </text>
            )}
            {flyableRows.length > 0 && certByDay?.[day] && (() => {
              const { label, color } = certLabel(certByDay[day].agree, certByDay[day].total)
              return (
                <text x={LEFT - 5} y={y + DAY_H / 2 + 24} fontSize={8} fill={color} textAnchor="end" fontWeight="600">
                  {label}
                </text>
              )
            })()}
            {flyableRows.map((r, i) => (
              <rect key={i} x={scale(r.start)} y={y + 14} width={Math.max(scale(r.end) - scale(r.start), 1)} height={22}
                fill={COLOR[r.type] || '#444'} rx={2} opacity={0.88}>
                <title>{r.type} – {r.point}</title>
              </rect>
            ))}
            {wRows.map((r, i) => (
              <rect key={'w' + i} x={scale(r.start)} y={y + 14} width={Math.max(scale(r.end) - scale(r.start), 1)} height={22}
                fill={WEATHER_COLOR[r.type] || '#666'} rx={2} opacity={0.6}>
                <title>{r.type}</title>
              </rect>
            ))}
          </g>
        )
      })}
    </svg>
  )
}

const FLYABLE_DISCLAIMER = "The calculated flyable hours and windows are only an optimistic estimate based on your indicated wing type and weight, and are in no case a replacement for the pilot's own judgement. Always verify that forecasted conditions are appropriate for your exact wing model, skill level, physical ability and risk tolerance. See the Info tab for details on how flyability is calculated."

const Legend_ = ({ items }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: "clamp(8px, 1.4vw, 12px)", color: T.text2 }}>
    {items.map(({ color, name }) => (
      <span key={name} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 9, height: 9, background: color, borderRadius: 2, flexShrink: 0, display: 'inline-block' }} />
        {name}
      </span>
    ))}
  </div>
)

const Legendsmall_ = ({ items }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', fontSize: "clamp(6px, 1.4vw, 12px)", color: T.text2 }}>
    {items.map(({ color, name }) => (
      <span key={name} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 9, height: 9, background: color, borderRadius: 2, flexShrink: 0, display: 'inline-block' }} />
        {name}
      </span>
    ))}
  </div>
)

export default function MapForecast({ data }) {
  const { displayForecast, certainty, points, days, dateIdx } = data
  const mapRef    = useRef(null)
  const leafletRef = useRef(null)
  const layersRef  = useRef([])

  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return
    leafletRef.current = L.map(mapRef.current).setView([52.04, 4.20], 8)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(leafletRef.current)
    return () => { leafletRef.current?.remove(); leafletRef.current = null }
  }, [])

  useEffect(() => {
    if (!leafletRef.current || !displayForecast || !points.length) return
    layersRef.current.forEach(l => l.remove())
    layersRef.current = []
    const map   = leafletRef.current
    const dayPf = displayForecast[dateIdx] || []
    dayPf.forEach((pf, ptIdx) => {
      const point = points[ptIdx]
      if (!point) return
      windPolygons(point, pf).forEach(poly => {
        layersRef.current.push(
          L.polygon(poly.coords, { color: poly.color, weight: 2, fillColor: poly.color, fillOpacity: 0.7 }).addTo(map)
        )
      })
      const color = markerColor(pf)
      layersRef.current.push(
        L.circleMarker([point.lat, point.lon], { radius: 6, color, fillColor: color, fillOpacity: 1, weight: 2 })
          .bindPopup(`<b>${point.name}</b><br/>Good: ${pf.wind_pizza[1]}h | Cross: ${pf.wind_pizza[0]+pf.wind_pizza[2]}h`)
          .addTo(map)
      )
    })
  }, [displayForecast, points, dateIdx])

  const { barData, ganttRows, weatherRows, certByDay, weatherByDay } = useMemo(() => {
    if (!displayForecast || !points.length) return { barData: [], ganttRows: [], weatherRows: [], certByDay: {}, weatherByDay: {} }
    const bar = [], gantt = [], weather = [], certByDayMap = {}, weatherByDayMap = {}
    displayForecast.forEach((dayPf, di) => {
      let bestFly = 0
      dayPf.forEach(pf => { const f = pf.good_hours + pf.cross_hours + pf.gusty_hours + pf.cross_gusty_hours; if (f > bestFly) bestFly = f })
      let best = 0, bestGood = -1
      dayPf.forEach((pf, pi) => {
        const f = pf.good_hours + pf.cross_hours + pf.gusty_hours + pf.cross_gusty_hours
        if (f === bestFly && pf.good_hours > bestGood) { bestGood = pf.good_hours; best = pi }
      })
      const bpf = dayPf[best], bpt = points[best]
      bar.push({
        day: days[di] || `Day ${di}`,
        good: bpf?.good_hours || 0, cross: bpf?.cross_hours || 0,
        gusty: bpf?.gusty_hours || 0, cross_gusty: bpf?.cross_gusty_hours || 0,
        label: ((bpf?.good_hours||0)+(bpf?.cross_hours||0)+(bpf?.gusty_hours||0)+(bpf?.cross_gusty_hours||0)) > 0 ? (bpt?.name||'') : '',
      })
      const dayName = days[di] || `Day ${di}`
      if (certainty?.[di]) certByDayMap[dayName] = certainty[di]
      weatherByDayMap[dayName] = { has_fog: bestFly > 0 && !!(bpf?.has_fog), has_rain: bestFly > 0 && !!(bpf?.has_rain) }
      if (bpf?.gantt)      bpf.gantt.forEach(g => gantt.push({ day: dayName, point: bpt?.name||'', type: g.type, start: g.start, end: g.end }))
      if (bestFly > 0 && bpf?.fog_gantt)  bpf.fog_gantt.forEach(g => weather.push({ day: dayName, type: g.type, start: g.start, end: g.end }))
      if (bestFly > 0 && bpf?.rain_gantt) bpf.rain_gantt.forEach(g => weather.push({ day: dayName, type: g.type, start: g.start, end: g.end }))
    })
    return { barData: bar, ganttRows: gantt, weatherRows: weather, certByDay: certByDayMap, weatherByDay: weatherByDayMap }
  }, [displayForecast, points, days, certainty])

  const TOOLTIP_STYLE = {
    contentStyle: { background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 12, fontFamily: T.font },
    labelStyle: { color: T.text2 },
  }

  return (
    <div>
      {/* Map */}
      <div ref={mapRef} style={{
        height: 420, borderRadius: 8, overflow: 'hidden', marginBottom: 24,
        border: `1px solid ${T.borderDim}`, zIndex: 0, position: 'relative',
      }} />

      {/* Bar chart */}
      <div style={{ position: 'relative' }}>
        {barData.some(d => weatherByDay[d.day]?.has_fog || weatherByDay[d.day]?.has_rain) && (
          <div style={{ position: 'absolute', top: 'clamp(20px, -2.5vw, 14px)', left: 28, right: 8, display: 'flex', zIndex: 1, pointerEvents: 'none' }}>
            {barData.map((d, i) => {
              const w = weatherByDay[d.day]
              if (!w?.has_fog && !w?.has_rain) return <div key={i} style={{ flex: 1 }} />
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                  {w.has_rain && <span style={{ fontSize: 'clamp(7px,1.4vw,10px)', fontWeight: 600, color: '#3a7bd5', background: '#4a8fd418', padding: '1px 4px', borderRadius: 3, lineHeight: 1.3, display: 'inline-block' }}>Rain</span>}
                  {w.has_fog  && <span style={{ fontSize: 'clamp(7px,1.4vw,10px)', fontWeight: 600, color: '#9090b0', background: '#9090b018', padding: '1px 4px', borderRadius: 3, lineHeight: 1.3, display: 'inline-block' }}>Fog</span>}
                </div>
              )
            })}
          </div>
        )}
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={barData} margin={{ top: 40, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="day" tick={{ fill: T.text2, fontSize: 12, fontFamily: T.font }} />
            <YAxis width={28} tick={{ fill: T.text2, fontSize: 12, fontFamily: T.font }} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(val, name) => val > 0 ? [`${val}h`, name] : [null, null]} />
            <Bar dataKey="good"        name="Good wind"        stackId="a" fill={C.good}       radius={[0,0,0,0]} />
            <Bar dataKey="cross"       name="Crosswind"        stackId="a" fill={C.cross}      radius={[0,0,0,0]} />
            <Bar dataKey="gusty"       name="Gusty"            stackId="a" fill={C.gusty}      radius={[0,0,0,0]} />
            <Bar dataKey="cross_gusty" name="Crosswind, Gusty" stackId="a" fill={C.crossGusty} radius={[0,0,0,0]}>
              <LabelList dataKey="label" position="top" style={{ fill: T.text2, fontSize: 'clamp(8px,1.4vw,10px)' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Certainty row */}
      {certainty && certainty.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 'clamp(-18px,-2.5vw,-10px)' }}>
          <div style={{ width: 28, flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', paddingRight: 8 }}>
            {barData.map((d, i) => {
              const totalHours = (d.good||0)+(d.cross||0)+(d.gusty||0)+(d.cross_gusty||0)
              const c = certainty[i]
              if (!c || totalHours === 0) return <div key={i} style={{ flex: 1 }} />
              const { label, color } = certLabel(c.agree, c.total)
              return (
                <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                  <span style={{ fontSize: 'clamp(7px,1.4vw,10px)', fontWeight: 600, color, background: color+'18', padding: '2px 4px', borderRadius: 3, display: 'inline-block' }}>
                    {label.replace(' Confidence', '')}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Bar legend */}
      <div style={{ padding: '8px 0 4px' }}>
        <Legend_ items={[
          { color: C.good, name: 'Good wind' }, { color: C.cross, name: 'Crosswind' },
          { color: C.gusty, name: 'Gusty' }, { color: C.crossGusty, name: 'Crosswind, Gusty' },
        ]} />
      </div>

      {/* Gantt */}
      <div style={{ background: T.card, borderRadius: 8, padding: '12px 4px', border: `1px solid ${T.borderDim}`, overflowX: 'auto', marginTop: 8 }}>
        <GanttChart ganttRows={ganttRows} weatherRows={weatherRows} days={days} certByDay={certByDay} />
        <div style={{ padding: '6px 12px 0' }}>
          <Legendsmall_ items={[
            { color: C.good, name: 'Good wind' }, { color: C.cross, name: 'Crosswind' },
            { color: C.gusty, name: 'Gusty' }, { color: C.crossGusty, name: 'Crosswind, Gusty' },
            { color: C.rain, name: 'Rain' }, { color: C.fog, name: 'Fog' },
          ]} />
        </div>
      </div>

      {/* Disclaimer */}
      <div style={{
        marginTop: 20, padding: '10px 14px',
        background: T.card, borderRadius: 6,
        border: `1px solid ${T.borderDim}`,
        borderLeft: `3px solid ${T.border}`,
        fontSize: 11, color: T.text2, lineHeight: 1.55,
        display: 'flex', alignItems: 'flex-start', gap: 8,
      }}>
        <span>{FLYABLE_DISCLAIMER}</span>
      </div>
    </div>
  )
}
