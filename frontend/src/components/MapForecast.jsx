import React, { useEffect, useRef, useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, LabelList } from 'recharts'

// Leaflet is loaded via CDN in index.html; import the JS bundle here
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const DEG = Math.PI / 180

function toRad(d) { return d * DEG }

// Mirror of backend's wind-polygon logic
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
      color: i === 1 ? 'green' : 'orange',
    }
  }).filter(Boolean)
}

function markerColor(pf) {
  if (pf.good_hours >= 3) return 'green'
  if (pf.good_hours + pf.cross_hours > 0) return 'orange'
  return 'red'
}

// ── Gantt chart (custom SVG timeline) ────────────────────────────────────────
function GanttChart({ ganttRows, days }) {
  // ganttRows: array of { day, point, type, start, end }
  const COLOR = { good: '#1fd100', cross: '#d68800', no: 'transparent' }
  const DAY_H = 36
  const LEFT  = 90
  const RIGHT = 20
  const W     = 700

  const allTimes = ganttRows.flatMap(r => [new Date(r.start), new Date(r.end)])
  const minT = allTimes.length ? Math.min(...allTimes.map(t => t.getTime())) : 0
  const maxT = allTimes.length ? Math.max(...allTimes.map(t => t.getTime())) : 1
  const span = maxT - minT || 1

  const scale = (t) => LEFT + ((new Date(t).getTime() - minT) / span) * (W - LEFT - RIGHT)

  const grouped = {}
  for (const r of ganttRows) {
    if (!grouped[r.day]) grouped[r.day] = []
    grouped[r.day].push(r)
  }
  const dayKeys = [...new Set(ganttRows.map(r => r.day))]

  const svgH = dayKeys.length * DAY_H + 30

  // Hour labels
  const hourLabels = []
  if (minT && maxT) {
    const start = new Date(minT)
    start.setMinutes(0, 0, 0)
    for (let t = start.getTime(); t <= maxT; t += 3600_000) {
      const x = scale(new Date(t))
      if (x > LEFT && x < W - RIGHT) {
        hourLabels.push({ x, label: new Date(t).getHours() + ':00' })
      }
    }
  }

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${svgH}`} style={{ fontFamily: 'sans-serif' }}>
      {hourLabels.map(h => (
        <g key={h.label + h.x}>
          <line x1={h.x} y1={20} x2={h.x} y2={svgH} stroke="#333" strokeWidth={0.5} />
          <text x={h.x} y={14} fontSize={9} fill="#666" textAnchor="middle">{h.label}</text>
        </g>
      ))}
      {dayKeys.map((day, di) => {
        const y    = 20 + di * DAY_H
        const rows = grouped[day] || []
        const flyableRows = rows.filter(r => r.type !== 'no')
        const pointName   = flyableRows.length > 0 ? rows[0].point : null
        return (
          <g key={day}>
            {/* Day name */}
            <text x={LEFT - 4} y={y + DAY_H / 2} fontSize={11} fill="#aaa" textAnchor="end">{day}</text>
            {/* Point name — only when there are flyable hours */}
            {pointName && (
              <text x={LEFT - 4} y={y + DAY_H / 2 + 12} fontSize={9} fill="#666" textAnchor="end" fontStyle="italic">
                {pointName}
              </text>
            )}
            {flyableRows.map((r, i) => {
              const x1 = scale(r.start)
              const x2 = scale(r.end)
              return (
                <rect key={i} x={x1} y={y + 6} width={Math.max(x2 - x1, 1)} height={DAY_H - 12}
                  fill={COLOR[r.type] || '#555'} rx={2} opacity={0.85}>
                  <title>{r.type} – {r.point}</title>
                </rect>
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MapForecast({ data }) {
  const { displayForecast, points, days, dateIdx, model } = data
  const mapRef    = useRef(null)
  const leafletRef = useRef(null)
  const layersRef  = useRef([])

  // Init Leaflet map once
  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return
    leafletRef.current = L.map(mapRef.current).setView([52.04, 4.39], 8)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(leafletRef.current)
    return () => {
      leafletRef.current?.remove()
      leafletRef.current = null
    }
  }, [])

  // Redraw layers when date/model changes
  useEffect(() => {
    if (!leafletRef.current || !displayForecast || !points.length) return
    // Clear old layers
    layersRef.current.forEach(l => l.remove())
    layersRef.current = []

    const map   = leafletRef.current
    const dayPf = displayForecast[dateIdx] || []

    dayPf.forEach((pf, ptIdx) => {
      const point = points[ptIdx]
      if (!point) return

      // Wind polygons
      windPolygons(point, pf).forEach(poly => {
        const l = L.polygon(poly.coords, {
          color: poly.color, weight: 1, fillColor: poly.color, fillOpacity: 0.5,
        }).addTo(map)
        layersRef.current.push(l)
      })

      // Center dot
      const color = markerColor(pf)
      const l = L.circleMarker([point.lat, point.lon], {
        radius: 6, color, fillColor: color, fillOpacity: 1, weight: 2,
      }).bindPopup(`<b>${point.name}</b><br/>Good: ${pf.good_hours}h | Cross: ${pf.cross_hours}h`)
        .addTo(map)
      layersRef.current.push(l)
    })
  }, [displayForecast, points, dateIdx])

  // ── Bar chart data ────────────────────────────────────────────────────────
  const { barData, ganttRows } = useMemo(() => {
    if (!displayForecast || !points.length) return { barData: [], ganttRows: [] }

    const bar = []
    const gantt = []

    displayForecast.forEach((dayPf, di) => {
      let bestGood = -1, bestFly = -1, bestIdx = 0, bestFlyIdx = 0
      dayPf.forEach((pf, pi) => {
        if (pf.good_hours > bestGood) { bestGood = pf.good_hours; bestIdx = pi }
        const fly = pf.good_hours + pf.cross_hours
        if (fly > bestFly) { bestFly = fly; bestFlyIdx = pi }
      })
      const best = bestGood >= 0 ? bestIdx : bestFlyIdx
      const bpf = dayPf[best]
      const bpt = points[best]

      bar.push({
        day: days[di] || `Day ${di}`,
        good: bpf?.good_hours || 0,
        cross: bpf?.cross_hours || 0,
        label: ((bpf?.good_hours || 0) + (bpf?.cross_hours || 0)) > 0 ? (bpt?.name || '') : '',
      })

      if (bpf?.gantt) {
        bpf.gantt.forEach(g => {
          gantt.push({ day: days[di] || `Day ${di}`, point: bpt?.name || '', type: g.type, start: g.start, end: g.end })
        })
      }
    })

    return { barData: bar, ganttRows: gantt }
  }, [displayForecast, points, days])

  return (
    <div>
      {/* Map */}
      <div ref={mapRef} style={{ height: 420, borderRadius: 8, overflow: 'hidden', marginBottom: 24, border: '1px solid #2a2a3e' }} />

      {/* Flyable Hours Bar */}
      <h3 style={{ marginBottom: 12, color: '#ccc', fontSize: 16 }}>Flyable Hours Per Day</h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={barData} margin={{ top: 24, right: 20, left: 0, bottom: 4 }}>
          <XAxis dataKey="day" tick={{ fill: '#aaa', fontSize: 12 }} />
          <YAxis tick={{ fill: '#aaa', fontSize: 12 }} label={{ value: 'Hours', angle: -90, position: 'insideLeft', fill: '#888', fontSize: 12 }} />
          <Tooltip
            contentStyle={{ background: '#1e1e2e', border: '1px solid #3a3a5e', borderRadius: 6 }}
            labelStyle={{ color: '#ccc' }}
            formatter={(val, name, props) => [`${val}h – ${props.payload.label}`, name === 'good' ? 'Good wind' : 'Crosswind']}
          />
          <Legend wrapperStyle={{ color: '#aaa', fontSize: 13 }} />
          <Bar dataKey="cross" name="Crosswind" stackId="a" fill="#d68800" radius={[0, 0, 0, 0]} />
          <Bar dataKey="good"  name="Good wind"  stackId="a" fill="#1fd100" radius={[4, 4, 0, 0]}>
            <LabelList dataKey="label" position="top" style={{ fill: '#888', fontSize: 10 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Gantt timeline */}
      <h3 style={{ margin: '24px 0 12px', color: '#ccc', fontSize: 16 }}>Daily Wind Window</h3>
      <div style={{ background: '#1e1e2e', borderRadius: 8, padding: '12px 4px', border: '1px solid #2a2a3e', overflowX: 'auto' }}>
        <GanttChart ganttRows={ganttRows} days={days} />
        <div style={{ display: 'flex', gap: 16, padding: '8px 12px 0', fontSize: 12, color: '#888' }}>
          <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#1fd100', borderRadius: 2, marginRight: 4 }} />Good wind</span>
          <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#d68800', borderRadius: 2, marginRight: 4 }} />Crosswind</span>
        </div>
      </div>
    </div>
  )
}