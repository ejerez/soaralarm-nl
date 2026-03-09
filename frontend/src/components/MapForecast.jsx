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
  if (pf.good_hours > 0) return 'green'
  else if (pf.cross_hours > 0) return 'orange'
  else if (pf.gusty_hours > 0 || pf.cross_gusty_hours > 0) return 'red'
  return 'black'
}

const FLYABLE_DISCLAIMER = "The calculated flyable hours and flyable windows are only an (optimistic)\
 estimate based on your indicated wing type and weight, and are in no case a replacement for the pilot's\
 own judgement. Always check that the forecasted conditions are actually appropriate for your exact wing model,\
 skill level, physical ability and risk tolerance. Go to the Info tab for more information on how the flyability\
 is calculated."

// ── Info tooltip button ───────────────────────────────────────────────────────
function InfoTooltip({ text }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [open])

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block', verticalAlign: 'middle', marginLeft: 6 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: open ? '#3a5a8a' : 'transparent',
          color: open ? '#7eb8f7' : '#556',
          border: '1px solid #3a3a5e',
          borderRadius: '50%',
          width: 18, height: 18,
          fontSize: 11, lineHeight: 1,
          cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          padding: 0,
        }}
        aria-label="Info"
      >ⓘ</button>
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 280,
          background: '#252535',
          border: '1px solid #3a3a5e',
          borderRadius: 6,
          padding: '8px 12px',
          fontSize: 12,
          color: '#aaa',
          lineHeight: 1.5,
          zIndex: 100,
        }}>
          {text}
        </div>
      )}
    </span>
  )
}

export function certLabel(agree, total) {
  if (agree === 4) return { label: 'Very High Confidence', color: '#00e6bc' }
  if (agree === 3) return { label: 'High Confidence',      color: '#8fef00' }
  if (agree === 2) return { label: 'Medium Confidence',    color: '#ffa726' }
  return                  { label: 'Low Confidence',       color: '#ef5350' }
}

function GanttChart({ ganttRows, weatherRows, days, certByDay }) {
  // ganttRows: array of { day, point, type, start, end }  (flyable windows)
  // weatherRows: array of { day, type, start, end }       (fog / rain windows)
  const COLOR = { good: '#1fd100', cross: '#d1bb16', good_gusty: '#d68800', cross_gusty: '#c12e0d', no: 'transparent' }
  const WEATHER_COLOR = { fog: '#b0b0c8', rain: '#3a7bd5' }
  const DAY_H = 52
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
  const weatherGrouped = {}
  for (const r of (weatherRows || [])) {
    if (!weatherGrouped[r.day]) weatherGrouped[r.day] = []
    weatherGrouped[r.day].push(r)
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
    <svg width="100%" viewBox={`0 0 ${W + 120} ${svgH}`} style={{ fontFamily: 'sans-serif' }}>
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
        const wRows = weatherGrouped[day] || []
        return (
          <g key={day}>
            {/* Day name */}
            <text x={LEFT - 4} y={y + DAY_H / 2} fontSize={11} fill="#aaa" textAnchor="end">{day}</text>
            {/* Point name — only when there are flyable hours */}
            {pointName && (
              <text x={LEFT - 4} y={y + DAY_H / 2 + 12} fontSize="clamp(8px, 1.4vw, 10px)" fill="#666" textAnchor="end" fontStyle="italic">
                {pointName}
              </text>
            )}
            {/* Confidence label — right side, only when there are flyable hours */}
            {flyableRows.length > 0 && certByDay?.[day] && (() => {
              const { label, color } = certLabel(certByDay[day].agree, certByDay[day].total)
              return (
                <text x={LEFT - 4} y={y + DAY_H / 2 + 22} fontSize={8} fill={color}
                  textAnchor="end" fontWeight="bold">
                  {label}
                </text>
              )
            })()}
            {/* Flyable bars — main band */}
            {flyableRows.map((r, i) => {
              const x1 = scale(r.start)
              const x2 = scale(r.end)
              return (
                <rect key={i} x={x1} y={y + 14} width={Math.max(x2 - x1, 1)} height={22}
                  fill={COLOR[r.type] || '#555'} rx={2} opacity={0.85}>
                  <title>{r.type} – {r.point}</title>
                </rect>
              )
            })}
            {/* Weather strip — fog/rain band below flyable bars */}
            {wRows.map((r, i) => {
              const x1 = scale(r.start)
              const x2 = scale(r.end)
              return (
                <rect key={'w' + i} x={x1} y={y + 14} width={Math.max(x2 - x1, 1)} height={22}
                  fill={WEATHER_COLOR[r.type] || '#888'} rx={2} opacity={0.85}>
                  <title>{r.type}</title>
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
  const { displayForecast, certainty, points, days, dateIdx, model } = data
  const mapRef    = useRef(null)
  const leafletRef = useRef(null)
  const layersRef  = useRef([])

  // Init Leaflet map once
  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return
    leafletRef.current = L.map(mapRef.current).setView([52.04, 4.20], 8)
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
      const slices    = pf.wind_pizza
      const l = L.circleMarker([point.lat, point.lon], {
        radius: 6, color, fillColor: color, fillOpacity: 1, weight: 2,
      }).bindPopup(`<b>${point.name}</b><br/>Good: ${slices[1]}h | Cross: ${slices[0]+slices[2]}h`)
        .addTo(map)
      layersRef.current.push(l)
    })
  }, [displayForecast, points, dateIdx])

  // ── Bar chart data ────────────────────────────────────────────────────────
  const { barData, ganttRows, weatherRows, certByDay, weatherByDay } = useMemo(() => {
    if (!displayForecast || !points.length) return { barData: [], ganttRows: [], weatherRows: [], certByDay: {}, weatherByDay: {} }

    const bar = []
    const gantt = []
    const weather = []
    const certByDayMap = {}
    const weatherByDayMap = {}

    displayForecast.forEach((dayPf, di) => {
      let bestFly = 0
      dayPf.forEach((pf) => {
        const fly = pf.good_hours + pf.cross_hours + pf.gusty_hours + pf.cross_gusty_hours
        if (fly > bestFly) bestFly = fly
      })
      // Among all points tied at bestFly, pick the one with the most good hours (lowest index breaks ties)
      let best = 0, bestGood = -1
      dayPf.forEach((pf, pi) => {
        const fly = pf.good_hours + pf.cross_hours + pf.gusty_hours + pf.cross_gusty_hours
        if (fly === bestFly && pf.good_hours > bestGood) { bestGood = pf.good_hours; best = pi }
      })
      const bpf = dayPf[best]
      const bpt = points[best]

      bar.push({
        day: days[di] || `Day ${di}`,
        good:  bpf?.good_hours  || 0,
        cross: bpf?.cross_hours || 0,
        gusty: bpf?.gusty_hours || 0,
        cross_gusty: bpf?.cross_gusty_hours || 0,
        label: ((bpf?.good_hours || 0) + (bpf?.cross_hours || 0) + (bpf?.gusty_hours || 0) + (bpf?.cross_gusty_hours || 0)) > 0 ? (bpt?.name || '') : '',
      })

      const dayName = days[di] || `Day ${di}`
      if (certainty?.[di]) certByDayMap[dayName] = certainty[di]

      // Weather (fog/rain) flags — use best point for this day
      const hasFly = bestFly > 0
      weatherByDayMap[dayName] = {
        has_fog:  hasFly && !!(bpf?.has_fog),
        has_rain: hasFly && !!(bpf?.has_rain),
      }

      if (bpf?.gantt) {
        bpf.gantt.forEach(g => {
          gantt.push({ day: dayName, point: bpt?.name || '', type: g.type, start: g.start, end: g.end })
        })
      }
      // Fog/rain gantt strips — only on flyable days
      if (bestFly > 0 && bpf?.fog_gantt) {
        bpf.fog_gantt.forEach(g => {
          weather.push({ day: dayName, type: g.type, start: g.start, end: g.end })
        })
      }
      if (bestFly > 0 && bpf?.rain_gantt) {
        bpf.rain_gantt.forEach(g => {
          weather.push({ day: dayName, type: g.type, start: g.start, end: g.end })
        })
      }
    })

    return { barData: bar, ganttRows: gantt, weatherRows: weather, certByDay: certByDayMap, weatherByDay: weatherByDayMap }
  }, [displayForecast, points, days, certainty])

  return (
    <div>
      {/* Map */}
      <div ref={mapRef} style={{ height: 420, borderRadius: 8, overflow: 'hidden', marginBottom: 24, border: '1px solid #2a2a3e', zIndex: 0, position: 'relative' }} />

      {/* Flyable Hours Bar */}
      <h3 style={{ marginBottom: 12, color: '#ccc', fontSize: 16 }}>Possible Flyable Hours (Best Locations)</h3>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={barData} margin={{ top: 24, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey="day" tick={{ fill: '#aaa', fontSize: 12 }} />
          <YAxis width={28} tick={{ fill: '#aaa', fontSize: 12 }} />
          <Tooltip
            contentStyle={{ background: '#1e1e2e', border: '1px solid #3a3a5e', borderRadius: 6 }}
            labelStyle={{ color: '#ccc' }}
            formatter={(val, name) => val > 0 ? [`${val}h`, name] : [null, null]}
          />
          <Bar dataKey="good"        name="Good wind"        stackId="a" fill="#1fd100" radius={[0, 0, 0, 0]} />
          <Bar dataKey="cross"       name="Crosswind"        stackId="a" fill="#d1bb16" radius={[0, 0, 0, 0]} />
          <Bar dataKey="gusty"       name="Gusty"            stackId="a" fill="#d68800" radius={[0, 0, 0, 0]} />
          <Bar dataKey="cross_gusty" name="Crosswind, Gusty" stackId="a" fill="#c12e0d" radius={[0, 0, 0, 0]}>
            <LabelList dataKey="label" position="top" style={{ fill: '#888', fontSize: 'clamp(8px, 1.4vw, 10px)' }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Certainty row — below chart, above legend */}
      {certainty && certainty.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 'clamp(-18px, -2.5vw, -10px)' }}>
          {/* Left spacer must exactly match YAxis width (28) + BarChart left margin (0) */}
          <div style={{ width: 28, flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', paddingRight: 8 }}>
            {barData.map((d, i) => {
              const totalHours = (d.good || 0) + (d.cross || 0) + (d.gusty || 0) + (d.cross_gusty || 0)
              const c = certainty[i]
              if (!c || totalHours === 0) return <div key={i} style={{ flex: 1 }} />
              const { label, color } = certLabel(c.agree, c.total)
              const shortLabel = label.replace(' Confidence', '')
              return (
                <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                  <span style={{
                    fontSize: 'clamp(7px, 1.4vw, 10px)',
                    fontWeight: 700,
                    color,
                    background: color + '22',
                    padding: '2px 3px',
                    borderRadius: 4,
                    lineHeight: 1.2,
                    display: 'inline-block',
                  }}>
                    {shortLabel}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Weather badges row — fog / rain on flyable days */}
      {barData.some((d, i) => weatherByDay[d.day]?.has_fog || weatherByDay[d.day]?.has_rain) && (
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 4 }}>
          <div style={{ width: 28, flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', paddingRight: 8 }}>
            {barData.map((d, i) => {
              const w = weatherByDay[d.day]
              if (!w?.has_fog && !w?.has_rain) return <div key={i} style={{ flex: 1 }} />
              return (
                <div key={i} style={{ flex: 1, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  {w.has_rain && (
                    <span style={{ fontSize: 'clamp(7px, 1.4vw, 10px)', fontWeight: 700, color: '#3a7bd5', background: '#3a7bd522', padding: '2px 3px', borderRadius: 4, lineHeight: 1.2, display: 'inline-block' }}>
                      Rain
                    </span>
                  )}
                  {w.has_fog && (
                    <span style={{ fontSize: 'clamp(7px, 1.4vw, 10px)', fontWeight: 700, color: '#9090b8', background: '#9090b822', padding: '2px 3px', borderRadius: 4, lineHeight: 1.2, display: 'inline-block' }}>
                      Fog
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Manual legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', justifyContent: 'center', padding: '8px 0 4px', fontSize: 13, color: '#aaa' }}>
        {[
          { color: '#1fd100', name: 'Good wind' },
          { color: '#d1bb16', name: 'Crosswind' },
          { color: '#d68800', name: 'Gusty' },
          { color: '#c12e0d', name: 'Crosswind, Gusty' },
        ].map(({ color, name }) => (
          <span key={name} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: color, borderRadius: 2, flexShrink: 0 }} />
            {name}
          </span>
        ))}
      </div>

      <h3 style={{ margin: '24px 0 12px', color: '#ccc', fontSize: 16 }}>Possible Flyable Windows (Best Locations)</h3>
      <div style={{ background: '#1e1e2e', borderRadius: 8, padding: '12px 4px', border: '1px solid #2a2a3e', overflowX: 'auto' }}>
        <GanttChart ganttRows={ganttRows} weatherRows={weatherRows} days={days} certByDay={certByDay} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', padding: '8px 12px 0', fontSize: 'clamp(10px, 1.8vw, 12px)', color: '#888' }}>
          {[
            { color: '#1fd100', name: 'Good wind' },
            { color: '#d1bb16', name: 'Crosswind' },
            { color: '#d68800', name: 'Gusty' },
            { color: '#c12e0d', name: 'Crosswind, Gusty' },
            { color: '#2b5fa7', name: 'Rain' },
            { color: '#9d9dad', name: 'Fog' },
          ].map(({ color, name }) => (
            <span key={name} style={{ display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, background: color, borderRadius: 2, marginRight: 4, flexShrink: 0 }} />
              {name}
            </span>
          ))}
        </div>
      </div>
    
      {/* Disclaimer */}
      <h3 style={{ margin: '24px 0 12px', color: '#ccc', fontSize: 'clamp(8px, 1.2vw, 10px)' }}>DISCLAIMER</h3>
      <div style={{ fontSize: 'clamp(8px, 1.2vw, 10px)', background: '#1e1e2e', borderRadius: 8, padding: '12px 4px', border: '1px solid #2a2a3e', overflowX: 'auto' }}>
        {FLYABLE_DISCLAIMER}
      </div> 
    </div>
  )
}