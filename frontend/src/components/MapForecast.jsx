import React, { useEffect, useRef, useMemo, useState } from 'react'
import { fs, fsc } from '../fs.js'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, LabelList, ReferenceArea } from 'recharts'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { compareLocations, findBestLocationIndex } from '../locationSort.js'

const DEG = Math.PI / 180
function toRad(d) { return d * DEG }

const DAY_SHORT = {
  Yesterday: 'Yest.', Today: 'Today', Tomorrow: 'Tomr.',
  Monday: 'Mon.', Tuesday: 'Tue.', Wednesday: 'Wed.',
  Thursday: 'Thu.', Friday: 'Fri.', Saturday: 'Sat.', Sunday: 'Sun.',
}
function shortenDay(d) { return DAY_SHORT[d] ?? d }

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
  font:      "'Atkinson Hyperlegible', system-ui, sans-serif",
}
// Flyable colours — slightly desaturated for a more refined look
const C = {
  good:        '#1dbb02',
  cross:       '#ddb60a',
  gusty:       '#d67900',
  crossGusty:  '#c12e0d',
  rain:        '#1b8fe2',
  fog:         '#8888a0',
}

function windPolygons(point, pf, maxMag) {
  const head      = toRad(point.heading)
  const good      = point.head_range.good
  const cross     = point.head_range.cross
  const relBounds = [cross[0], good[0], good[1], cross[1]]
  const slices    = pf.wind_pizza
  return relBounds.slice(0, 3).map((_, i) => {
    const ang1 = head + toRad(relBounds[i])
    const ang2 = head + toRad(relBounds[i + 1])
    const mag  = (slices[i] / maxMag) * 3 * 0.04
    if (mag === 0) return null
    return {
      coords: [
        [point.lat, point.lon],
        [point.lat + mag * Math.cos(ang1), point.lon + 1.63 * mag * Math.sin(ang1)],
        [point.lat + mag * Math.cos(ang2), point.lon + 1.63 * mag * Math.sin(ang2)],
      ],
      color: i === 1 ? C.good : C.cross,
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
  if (agree === 4) return { label: '★★★★', color: '#00e6bc' }
  if (agree === 3) return { label: '★★★',      color: '#00ef3c' }
  if (agree === 2) return { label: '★★',    color: '#dbff26' }
  return                  { label: '★',       color: '#d3357c' }
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
        fontSize: fs(10), lineHeight: 1,
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
          fontSize: fs(12), color: T.text2, lineHeight: 1.55, zIndex: 100,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          {text}
        </div>
      )}
    </span>
  )
}

function GanttChart({ ganttRows, weatherRows, days, certByDay, onDayClick, dateIdx, isLocations, effectiveTimeStart, effectiveTimeEnd }) {
  const COLOR         = { good: C.good, cross: C.cross, good_gusty: C.gusty, cross_gusty: C.crossGusty, no: 'transparent' }
  const WEATHER_COLOR = { fog: C.fog, rain: C.rain }

  // Measure container so all sizes are in real pixels — no viewBox shrinkage on mobile
  const containerRef = useRef(null)
  const [W, setW] = useState(700)
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect?.width
      if (w > 0) setW(w)
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // All layout values scale with W
  const RIGHT  = 8
  const DAY_H  = Math.round(Math.max(46, Math.min(58, W * 0.115)))
  const BAR_Y  = Math.round(DAY_H * 0.27)   // top of coloured bar within row
  const BAR_H  = Math.round(DAY_H * 0.46)   // height of coloured bar
  const FS_HR  = Math.round(Math.max(9,  Math.min(11, W * 0.018)))   // hour labels
  const FS_DAY = Math.round(Math.max(11, Math.min(14, W * 0.024)))   // day name
  const FS_PT  = Math.round(Math.max(9,  Math.min(11, W * 0.019)))   // point name
  const FS_CRT = Math.round(Math.max(8,  Math.min(10, W * 0.016)))   // certainty
  const TYPE_LABEL = { good: 'Good', cross: 'Crosswind', good_gusty: 'Gusty', cross_gusty: 'Crosswind, Gusty', fog: 'Fog', rain: 'Rain' }
  const fmtH = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` }
  const [tooltip, setTooltip] = useState(null)

  const grouped = {}
  for (const r of ganttRows) { if (!grouped[r.day]) grouped[r.day] = []; grouped[r.day].push(r) }
  const weatherGrouped = {}
  for (const r of (weatherRows || [])) { if (!weatherGrouped[r.day]) weatherGrouped[r.day] = []; weatherGrouped[r.day].push(r) }
  const dayKeys = [...new Set(ganttRows.map(r => r.day))]

  // LEFT must be wide enough to fit the longest label (day name or point name)
  let LEFT
  if (isLocations) {
    // Canvas measurement for accurate location-name widths
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    ctx.font = `600 ${FS_DAY}px ${T.font}`
    const maxDayW = Math.max(0, ...dayKeys.map(d => ctx.measureText(d || '').width))
    LEFT = Math.round(maxDayW + 10)
  } else {
    const longestPtChars  = Math.max(0, ...ganttRows.map(r => (r.point || '').length))
    const longestDayChars = Math.max(0, ...dayKeys.map(d => (d || '').length))
    LEFT = Math.round(Math.max(
      longestPtChars  * FS_PT  * 0.52 + 6,
      longestDayChars * FS_DAY * 0.52 + 6,
    ))
  }

  // Use effective time window for X-axis range when provided
  const allTimes = [
    ...ganttRows,
    ...(weatherRows || []),
  ].flatMap(r => [new Date(r.start), new Date(r.end)])
  
  let rawMinT, rawMaxT
  if (effectiveTimeStart && effectiveTimeEnd) {
    // Use effective time window for X-axis range
    const effectiveStartDate = new Date(ganttRows[0]?.start || new Date())
    effectiveStartDate.setHours(...effectiveTimeStart.split(':').map(Number))
    effectiveStartDate.setMinutes(0, 0, 0)
    
    const effectiveEndDate = new Date(ganttRows[0]?.start || new Date())
    effectiveEndDate.setHours(...effectiveTimeEnd.split(':').map(Number))
    effectiveEndDate.setMinutes(0, 0, 0)
    
    rawMinT = effectiveStartDate.getTime()
    rawMaxT = effectiveEndDate.getTime()
  } else {
    // Fallback to data-driven range
    rawMinT = allTimes.length ? Math.min(...allTimes.map(t => t.getTime())) : 0
    rawMaxT = allTimes.length ? Math.max(...allTimes.map(t => t.getTime())) : 1
  }
  
  const minT    = rawMinT - 1800_000  // -30 min so first bar gets its left padding
  const maxT    = rawMaxT             // bars shift 30 min left, providing natural right margin
  const span = maxT - minT || 1
  const scale = (t) => LEFT + ((new Date(t).getTime() - minT) / span) * (W - LEFT - RIGHT)

  // Compute visual x/width for a half-open interval [start, end)
  // Single-point bars (start===end) get centered ±30min; all bars clamp to LEFT
  const barGeom = (start, end) => {
    const sMs = new Date(start).getTime()
    const eMs = new Date(end).getTime()
    const visStart = sMs - 1800_000
    const visEnd   = sMs === eMs ? sMs + 1800_000 : eMs - 1800_000
    const x  = Math.max(LEFT, scale(visStart))
    const x2 = scale(visEnd)
    return { x, width: Math.max(x2 - x, 1) }
  }
  const barTime = (start, end) => {
    const sMs = new Date(start).getTime()
    const eMs = new Date(end).getTime()
    if (sMs === eMs) return fmtH(start)
    const startFmt = fmtH(start); const endFmt = fmtH(new Date(eMs - 3600_000))
    return startFmt === endFmt ? startFmt : `${startFmt} – ${endFmt}`
  }

  const svgH = dayKeys.length * DAY_H + 30
  const hourLabels = []
  if (minT && maxT) {
    const start = new Date(minT); start.setMinutes(0, 0, 0)
    // On narrow screens show only even hours to avoid crowding
    const step = W < 400 ? 7200_000 : 3600_000
    for (let t = start.getTime(); t <= maxT; t += step) {
      const x = scale(new Date(t))
      if (x >= LEFT - FS_HR && x < W - RIGHT) hourLabels.push({ x, label: new Date(t).getHours() + ':00' })
    }
  }

  return (
    <div ref={containerRef} style={{ width: '100%', position: 'relative' }} onClick={() => setTooltip(null)}>
      {tooltip && (
        <div style={{
          position: 'absolute', left: Math.min(tooltip.x, W - 160), top: tooltip.y - 46,
          background: T.card, border: `1px solid ${T.borderEm}`, borderRadius: 6,
          padding: '6px 10px', fontSize: fs(12), color: T.text, fontFamily: T.font,
          pointerEvents: 'none', zIndex: 10, whiteSpace: 'nowrap',
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        }}>
          <div style={{ fontWeight: 600 }}>{tooltip.label}</div>
          <div style={{ color: T.text2, marginTop: 2 }}>{tooltip.time}</div>
        </div>
      )}
      <svg width={W} height={svgH} style={{ fontFamily: T.font, display: 'block' }}>
        {hourLabels.map(h => (
          <g key={h.label + h.x}>
            <line x1={h.x} y1={20} x2={h.x} y2={svgH} stroke="#2a2a2a" strokeWidth={0.5} />
            <text x={h.x} y={14} fontSize={fs(FS_HR)} fill={T.text3} textAnchor="middle">{h.label}</text>
          </g>
        ))}
        {dayKeys.map((day, di) => {
          const y    = 20 + di * DAY_H
          const rows = grouped[day] || []
          const flyableRows = rows.filter(r => r.type !== 'no')
          const pointName   = flyableRows.length > 0 ? rows[0].point : null
          const wRows = weatherGrouped[day] || []
          const hasCert = flyableRows.length > 0 && certByDay?.[day]
          const isSelectedDay = days.indexOf(day) === dateIdx
          // Vertical layout within row: day name + optional point + optional cert
          const lineCount = 1 + (pointName ? 1 : 0) + (hasCert ? 1 : 0)
          const lineH = FS_DAY * 1.35
          const blockH = lineCount * lineH
          const textTop = y + (DAY_H - blockH) / 2 + FS_DAY * 0.85
          return (
            <g key={day}>
              {isSelectedDay && (
                <rect x={0} y={y} width={W} height={DAY_H} fill="#ffffff" opacity={0.1} rx={4} />
              )}
              <text x={LEFT - 5} y={textTop} fontSize={fs(FS_DAY)} fill={isSelectedDay ? T.text : T.text2} textAnchor="end" fontWeight={isSelectedDay ? 600 : 400}>{day}</text>
              {pointName && (
                <text x={LEFT - 5} y={textTop + lineH} fontSize={fs(FS_PT)} fill={isSelectedDay ? T.text2 : T.text3} textAnchor="end" fontStyle="italic" fontWeight={isSelectedDay ? 600 : 400}>
                  {pointName}
                </text>
              )}
              {hasCert && (() => {
                const { label, color } = certLabel(certByDay[day].agree, certByDay[day].total)
                const certY = textTop + lineH * (pointName ? 2 : 1)
                return (
                  <text x={LEFT - 5} y={certY} fontSize={fs(FS_CRT)} fill={color} textAnchor="end" fontWeight="600">
                    {label.replace(' Confidence', '')}
                  </text>
                )
              })()}
              {flyableRows.map((r, i) => (
                <rect key={i} {...barGeom(r.start, r.end)} y={y + BAR_Y} height={BAR_H}
                  fill={COLOR[r.type] || '#444'} rx={2} opacity={0.88} style={{ cursor: 'pointer' }}
                  onClick={e => { e.stopPropagation(); const di = days.indexOf(day); if (onDayClick && di !== -1) onDayClick(di); setTooltip({ label: TYPE_LABEL[r.type] || r.type, time: barTime(r.start, r.end), x: barGeom(r.start, r.end).x, y: y + BAR_Y }) }}
                />
              ))}
              {wRows.map((r, i) => (
                <rect key={'w' + i} {...barGeom(r.start, r.end)} y={y + BAR_Y} height={BAR_H}
                  fill={WEATHER_COLOR[r.type] || '#666'} rx={2} opacity={0.6} style={{ cursor: 'pointer' }}
                  onClick={e => { e.stopPropagation(); const di = days.indexOf(day); if (onDayClick && di !== -1) onDayClick(di); setTooltip({ label: TYPE_LABEL[r.type] || r.type, time: barTime(r.start, r.end), x: barGeom(r.start, r.end).x, y: y + BAR_Y }) }}
                />
              ))}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

const FLYABLE_DISCLAIMER = "By using soaralarm, you aknowledge that the calculated flyable hours and windows, as well as any other information provided by Soaralarm, are purely indicative in nature, and in no circumstance guarantee that you will be able to fly safely. The pilot is always responsible for the decision to go fly, and Soaralarm is not responsible for such decision or any unintended consequences of it. Always verify that forecasted conditions are appropriate for your exact wing model, skill level, physical ability and risk tolerance. See the Info tab for details on how flyability is calculated."

const Legend_ = ({ items }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: fsc(8, '1.4vw', 12), color: T.text2 }}>
    {items.map(({ color, name }) => (
      <span key={name} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 9, height: 9, background: color, borderRadius: 2, flexShrink: 0, display: 'inline-block' }} />
        {name}
      </span>
    ))}
  </div>
)

const Legendsmall_ = ({ items }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', fontSize: fsc(6, '1.4vw', 12), color: T.text2 }}>
    {items.map(({ color, name }) => (
      <span key={name} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 9, height: 9, background: color, borderRadius: 2, flexShrink: 0, display: 'inline-block' }} />
        {name}
      </span>
    ))}
  </div>
)

export default function MapForecast({ data, onNavigateToPoint }) {
  const { displayForecast, certainty, points, days, dateIdx, setDateIdx, ptIdx, timeStart, timeEnd, effectiveTimeStart, effectiveTimeEnd } = data

  const [plotDays,     setPlotDays]     = useState(() => { try { return Number(localStorage.getItem('plotDays')) || 5 } catch { return 5 } })
  const [showYesterday, setShowYesterday] = useState(() => { try { return localStorage.getItem('showYesterday') === 'true' } catch { return false } })
  const [ganttMode, setGanttMode] = useState(() => { try { return localStorage.getItem('ganttMode') || 'locations' } catch { return 'locations' } })

  const mapRef     = useRef(null)
  const leafletRef = useRef(null)
  const layersRef  = useRef([])
  const markersRef = useRef([])
  const radarRef   = useRef(null)
  const ptIdxRef   = useRef(ptIdx)
  ptIdxRef.current = ptIdx

  // Smaller markers on narrow screens to reduce overlap in clusters
  const isMobile   = typeof window !== 'undefined' && window.innerWidth < 500
  const baseRadius = isMobile ? 3 : 5
  const selRadius  = isMobile ? 5 : 7

  // Compute bounds from points so the map auto-fits any country
  const pointsBounds = useMemo(() => {
    if (!points.length) return null
    const lats = points.map(p => p.lat)
    const lons = points.map(p => p.lon)
    // Pad bounds so wind slices aren't clipped at edges
    const PAD = 0.15
    return L.latLngBounds(
      [Math.min(...lats) - PAD, Math.min(...lons) - PAD],
      [Math.max(...lats) + PAD, Math.max(...lons) + PAD],
    )
  }, [points])

  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return
    const map = L.map(mapRef.current)
    if (pointsBounds) {
      map.fitBounds(pointsBounds, { animate: false })
    } else {
      map.setView([52.04, 4.20], 8)
    }
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map)
    leafletRef.current = map
    return () => { leafletRef.current?.remove(); leafletRef.current = null }
  }, [])

  // Re-fit when points change (e.g. country switch)
  useEffect(() => {
    if (leafletRef.current && pointsBounds) {
      leafletRef.current.fitBounds(pointsBounds, { animate: true })
    }
  }, [pointsBounds])

  // ── Rain radar overlay with animation (from server-cached measurements, Today only) ────
  const isToday = days[dateIdx] === 'Today'
  const rainTiles = data.measurements?.rain_tiles
  const [animateRadar, setAnimateRadar] = useState(true)
  const [currentTileIndex, setCurrentTileIndex] = useState(0)
  const sortedTilesRef = useRef([])
  
  // Debug: Log rain tiles data


  // Animation effect
  useEffect(() => {
    const map = leafletRef.current
    if (!map || !isToday || !rainTiles?.length) return

    // Create radar pane if it doesn't exist
    if (!map.getPane('radarPane')) {
      map.createPane('radarPane')
      map.getPane('radarPane').style.zIndex = 250
    }

    // Clean up existing overlay
    if (radarRef.current) { radarRef.current.remove(); radarRef.current = null }

    // If animation is disabled or only one tile, show current tile
    if (!animateRadar || rainTiles.length <= 1) {
      // Find the tile with the most recent timestamp (current tile)
      const currentTile = rainTiles.reduce((latest, tile) => 
        (tile.timestamp || 0) > (latest.timestamp || 0) ? tile : latest, 
        rainTiles[0]
      ) || rainTiles[rainTiles.length - 1]
      if (currentTile?.image && currentTile?.bounds) {
        const overlay = L.imageOverlay(currentTile.image, currentTile.bounds, {
          opacity: 0.55,
          pane: 'radarPane',
        })
        overlay.addTo(map)
        radarRef.current = overlay
      }
      return
    }

    // Sort tiles by timestamp (oldest to newest) for correct animation order
    const sortedTiles = [...rainTiles].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    
    // Calculate dynamic age and timestamp for each tile based on current time
    const now = Date.now()
    const tilesWithDynamicAge = sortedTiles.map(tile => {
      // Calculate timestamp if it's missing
      const timestamp = tile.timestamp || now
      return {
        ...tile,
        timestamp, // Ensure timestamp is always available
        dynamicAge: Math.floor((now - timestamp) / 60000) // age in minutes
      }
    })
    
    // Store the sorted tiles in a ref for use in the overlay effect
    sortedTilesRef.current = tilesWithDynamicAge
    
    // Animation logic with variable timing using setTimeout
    const sequence = tilesWithDynamicAge.map((_, index) => index)
    // Newest/most recent tile (last index) gets 3000ms, older tiles get 500ms
    const timings = sequence.map((_, index) => index === sequence.length - 1 ? 3000 : 500)
    
    let timeoutId = null
    let sequenceIndex = 0
    
    const runAnimationStep = () => {
      setCurrentTileIndex(sequence[sequenceIndex])
      
      const nextIndex = (sequenceIndex + 1) % sequence.length
      timeoutId = setTimeout(runAnimationStep, timings[sequenceIndex])
      sequenceIndex = nextIndex
    }
    
    // Start animation
    timeoutId = setTimeout(runAnimationStep, timings[0])
    
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      if (radarRef.current) { radarRef.current.remove(); radarRef.current = null }
    }
  }, [isToday, rainTiles, animateRadar])

  // Update overlay when tile index changes
  useEffect(() => {
    const map = leafletRef.current
    if (!map || !isToday || !rainTiles?.length || rainTiles.length <= 1) return


    
    if (radarRef.current) { radarRef.current.remove(); radarRef.current = null }

    // Use the sorted tiles from the ref to ensure consistency with the animation effect
    const tilesWithDynamicAge = sortedTilesRef.current
    
    const tile = tilesWithDynamicAge[currentTileIndex]
    if (tile?.image && tile?.bounds) {
      // Calculate timing for debug (don't need actual timings array here)
      const isLastTile = currentTileIndex === tilesWithDynamicAge.length - 1
      const displayTime = isLastTile ? 3000 : 500

      
      const overlay = L.imageOverlay(tile.image, tile.bounds, {
        opacity: 0.55,
        pane: 'radarPane',
      })
      overlay.addTo(map)
      radarRef.current = overlay
    } else {
      // No logging needed for this case
    }
  }, [isToday, rainTiles, currentTileIndex])

  useEffect(() => {
    if (!leafletRef.current || !displayForecast || !points.length) return
    layersRef.current.forEach(l => l.remove())
    layersRef.current = []
    markersRef.current = []
    const map   = leafletRef.current
    const dayPf = displayForecast[dateIdx] || []
    const maxMag = Math.max(1, ...dayPf.map(pf => Math.max(...(pf.wind_pizza || [0]))))
    // First pass: add wind-slice polygons (below markers)
    const markersByPi = []
    const pendingMarkers = []
    dayPf.forEach((pf, pi) => {
      const point = points[pi]
      if (!point) return
      windPolygons(point, pf, maxMag).forEach(poly => {
        const polygon = L.polygon(poly.coords, { color: poly.color, weight: 2, fillColor: poly.color, fillOpacity: 0.7 })
        polygon.on('click', () => { data.setPtIdx(pi); markersByPi[pi]?.openPopup() })
        polygon.addTo(map)
        layersRef.current.push(polygon)
      })
      pendingMarkers.push({ pf, pi, point })
    })
    // Second pass: add circle markers on top of polygons
    pendingMarkers.forEach(({ pf, pi, point }) => {
      const color = markerColor(pf)
      const spotLink = point.link
        ? `<br/><a href="${point.link}" target="_blank" rel="noopener noreferrer" style="color:#5578e8;font-size:12px;text-decoration:none;display:inline-block;margin-top:2px;">Spot information</a>`
        : ''
      const marker = L.circleMarker([point.lat, point.lon], {
        radius: baseRadius, color, fillColor: color, fillOpacity: 1, weight: 2,
      })
        .bindPopup(
          `<b>${point.name}</b><br/>Good heading: ${pf.wind_pizza[1]}h | Crosswind: ${pf.wind_pizza[0]+pf.wind_pizza[2]}h` +
          `<br/><a href="https://www.google.com/maps?q=${point.lat},${point.lon}" target="_blank" rel="noopener noreferrer" style="color:#5578e8;font-size:12px;text-decoration:none;display:inline-block;margin-top:4px;">` +
          `Google Maps</a>` + spotLink
        )
      marker.on('click', () => { data.setPtIdx(pi) })
      marker.addTo(map)
      markersByPi[pi] = marker
      markersRef.current.push({ marker, color })
      layersRef.current.push(marker)
    })
    // Apply highlight to current selection after creating markers
    const curPt = ptIdxRef.current
    markersRef.current.forEach(({ marker, color }, i) => {
      const selected = i === curPt
      marker.setRadius(selected ? selRadius : baseRadius)
      marker.setStyle({ color: selected ? '#000000' : color, weight: selected ? 3 : 2 })
      if (selected) marker.bringToFront()
    })
  }, [displayForecast, points, dateIdx])

  // Highlight selected marker without recreating all markers
  useEffect(() => {
    markersRef.current.forEach(({ marker, color }, i) => {
      const selected = i === ptIdx
      marker.setRadius(selected ? selRadius : baseRadius)
      marker.setStyle({
        color: selected ? '#000000' : color,
        weight: selected ? 3 : 2,
      })
      if (selected) marker.bringToFront()
    })
  }, [ptIdx, baseRadius, selRadius])

  const { barData, ganttRows, weatherRows, locGanttRows, locWeatherRows, locCertByDay, locDays, locPtMap, certByDay, weatherByDay } = useMemo(() => {
    if (!displayForecast || !points.length) return { barData: [], ganttRows: [], weatherRows: [], locGanttRows: [], locWeatherRows: [], locCertByDay: {}, locDays: [], locPtMap: [], certByDay: {}, weatherByDay: {} }
    // Clamp a gantt entry to the availability window; returns null if fully outside
    const clampToWindow = (g) => {
      const sDate = g.start.slice(0, 10) // "YYYY-MM-DD"
      const winStart = effectiveTimeStart !== '00:00' ? new Date(`${sDate}T${effectiveTimeStart}`).getTime() : -Infinity
      const winEnd   = effectiveTimeEnd !== '23:59'  ? new Date(`${sDate}T${effectiveTimeEnd}`).getTime()   :  Infinity
      const gStart = new Date(g.start).getTime()
      const gEnd   = new Date(g.end).getTime() || gStart // handle single-point
      if (gEnd <= winStart || gStart > winEnd) return null
      return {
        ...g,
        start: gStart < winStart          ? new Date(winStart).toISOString()              : g.start,
        end:   gEnd > winEnd + 3600_000   ? new Date(winEnd + 3600_000).toISOString()     : g.end,
      }
    }
    const bar = [], gantt = [], weather = [], certByDayMap = {}, weatherByDayMap = {}
    // di=0 is Yesterday, di=1 is Today; plotDays counts forward from Today
    const maxDi = plotDays  // Today=1 … Today+plotDays-1 = plotDays
    displayForecast.forEach((dayPf, di) => {
      if (di === 0 && !showYesterday) return
      if (di > maxDi) return
      const certDi = certainty?.[di]
      const best = findBestLocationIndex(dayPf, certDi, points)
      const bpf = dayPf[best], bpt = points[best]
      bar.push({
        day: shortenDay(days[di] || `Day ${di}`),
        fullDay: days[di] || `Day ${di}`,
        di,
        good: bpf?.good_hours || 0, cross: bpf?.cross_hours || 0,
        gusty: bpf?.gusty_hours || 0, cross_gusty: bpf?.cross_gusty_hours || 0,
        label: ((bpf?.good_hours||0)+(bpf?.cross_hours||0)+(bpf?.gusty_hours||0)+(bpf?.cross_gusty_hours||0)) > 0 ? (bpt?.name||'') : '',
      })
      const dayName  = days[di] || `Day ${di}`
      const shortDay = shortenDay(dayName)  // barData uses short names — key weather map the same way
      if (certainty?.[di]) certByDayMap[dayName] = certainty[di]
      weatherByDayMap[shortDay] = { has_fog: dayPf.some(pf => pf.has_fog), has_rain: dayPf.some(pf => pf.has_rain) }
      if (bpf?.gantt) bpf.gantt.forEach(g => {
        const c = clampToWindow({ day: dayName, point: bpt?.name||'', type: g.type, start: g.start, end: g.end })
        if (c) gantt.push(c)
      })
      const bestFly = (bpf?.good_hours||0) + (bpf?.cross_hours||0) + (bpf?.gusty_hours||0) + (bpf?.cross_gusty_hours||0)
      if (bestFly > 0 && bpf?.fog_gantt) bpf.fog_gantt.forEach(g => {
        const c = clampToWindow({ day: dayName, type: g.type, start: g.start, end: g.end })
        if (c) weather.push(c)
      })
      if (bestFly > 0 && bpf?.rain_gantt) bpf.rain_gantt.forEach(g => {
        const c = clampToWindow({ day: dayName, type: g.type, start: g.start, end: g.end })
        if (c) weather.push(c)
      })
    })

    // ── Locations mode: top 5 flyable locations for selected date ──────────
    const locGantt = [], locWeather = [], locCertMap = {}, locDays = [], locPtMap = []
    const dayPf = displayForecast[dateIdx] || []
    const certDay = certainty?.[dateIdx]
    // Score each point: flyable total > 0, then rank by confidence desc, priority asc, quality (good+gusty) desc, total flyable desc
    const scored = dayPf.map((pf, pi) => {
      const fly = pf.good_hours + pf.cross_hours + pf.gusty_hours + pf.cross_gusty_hours
      const quality = pf.good_hours + pf.gusty_hours
      const agree = certDay?.by_point?.[pi] ?? certDay?.agree ?? 0
      const priority = points[pi]?.priority ?? 0
      return { pi, pf, fly, quality, agree, priority }
    }).filter(s => s.fly > 0)
    scored.sort(compareLocations)
    const top = scored.slice(0, 5)
    top.forEach(({ pi, pf, agree }) => {
      const pt = points[pi]
      if (!pt) return
      const ptName = pt.name || `Point ${pi}`
      locDays.push(ptName)
      locPtMap.push(pi)
      if (certDay) locCertMap[ptName] = { agree, total: certDay.total }
      if (pf.gantt) pf.gantt.forEach(g => {
        const c = clampToWindow({ day: ptName, point: '', type: g.type, start: g.start, end: g.end })
        if (c) locGantt.push(c)
      })
      if (pf.fog_gantt) pf.fog_gantt.forEach(g => {
        const c = clampToWindow({ day: ptName, type: g.type, start: g.start, end: g.end })
        if (c) locWeather.push(c)
      })
      if (pf.rain_gantt) pf.rain_gantt.forEach(g => {
        const c = clampToWindow({ day: ptName, type: g.type, start: g.start, end: g.end })
        if (c) locWeather.push(c)
      })
    })

    return { barData: bar, ganttRows: gantt, weatherRows: weather, locGanttRows: locGantt, locWeatherRows: locWeather, locCertByDay: locCertMap, locDays, locPtMap, certByDay: certByDayMap, weatherByDay: weatherByDayMap }
  }, [displayForecast, points, days, certainty, plotDays, showYesterday, effectiveTimeStart, effectiveTimeEnd, dateIdx])
  const selectDay = (di) => { setDateIdx(di) }

  const TOOLTIP_STYLE = {
    contentStyle: { background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: fs(12), fontFamily: T.font },
    labelStyle: { color: T.text2 },
  }

  return (
    <div>
      {/* Map */}
      <div ref={mapRef} style={{
        height: 420, borderRadius: 8, overflow: 'hidden', marginBottom: 24,
        border: `1px solid ${T.borderDim}`, zIndex: 0, position: 'relative',
      }} data-tutorial="map" />

      {/* Plot controls */}
      <div data-tutorial="plotcontrols" style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10, flexWrap: 'wrap' }}>
        <label style={{ fontSize: fs(12), color: T.text2, display: 'flex', alignItems: 'center', gap: 6 }}>
          Forecast days
          <select
            value={plotDays}
            onChange={e => { const v = Number(e.target.value); setPlotDays(v); try { localStorage.setItem('plotDays', v) } catch {} }}
            style={{ background: T.raised, color: T.text, border: `1px solid ${T.borderEm}`, borderRadius: 5, padding: '3px 7px', fontSize: fs(12), cursor: 'pointer', fontFamily: T.font }}
          >
            <option value={3}>3</option>
            <option value={5}>5</option>
            <option value={7}>7</option>
          </select>
        </label>
        <label style={{ fontSize: fs(12), color: T.text2, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={showYesterday}
            onChange={e => { setShowYesterday(e.target.checked); try { localStorage.setItem('showYesterday', e.target.checked) } catch {} }}
            style={{ accentColor: T.accent, width: 13, height: 13, cursor: 'pointer' }}
          />
          Show yesterday
        </label>
        {isToday && rainTiles?.length > 1 && (
          <label style={{ fontSize: fs(12), color: T.text2, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={animateRadar}
              onChange={e => setAnimateRadar(e.target.checked)}
              style={{ accentColor: T.accent, width: 13, height: 13, cursor: 'pointer' }}
            />
            Enable radar animation
          </label>
        )}
        {isToday && rainTiles?.length <= 1 && (
          <div style={{ fontSize: fs(12), color: T.text3, marginLeft: 12 }}>
            Radar animation unavailable
          </div>
        )}
        {!isToday && (
          <div style={{ fontSize: fs(12), color: T.text3, marginLeft: 12 }}>
            Radar only available for Today
          </div>
        )}
      </div>

      {/* Bar chart */}
      <div data-tutorial="barchart" style={{ position: 'relative', WebkitTapHighlightColor: 'transparent' }}>
        {barData.some(d => weatherByDay[d.day]?.has_fog || weatherByDay[d.day]?.has_rain) && (
          <div style={{ position: 'absolute', top: 'clamp(20px, -2.5vw, 14px)', left: 28, right: 8, display: 'flex', zIndex: 1, pointerEvents: 'none' }}>
            {barData.map((d, i) => {
              const w = weatherByDay[d.day]
              if (!w?.has_fog && !w?.has_rain) return <div key={i} style={{ flex: 1 }} />
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                  {w.has_rain && <span style={{ fontSize: fsc(7, '1.4vw', 10), fontWeight: 600, color: '#3a7bd5', background: '#4a8fd418', padding: '1px 4px', borderRadius: 3, lineHeight: 1.3, display: 'inline-block' }}>Rain</span>}
                  {w.has_fog  && <span style={{ fontSize: fsc(7, '1.4vw', 10), fontWeight: 600, color: '#9090b0', background: '#9090b018', padding: '1px 4px', borderRadius: 3, lineHeight: 1.3, display: 'inline-block' }}>Fog</span>}
                </div>
              )
            })}
          </div>
        )}
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={barData} margin={{ top: 40, right: 8, left: 0, bottom: 0 }} onClick={e => { const d = e?.activePayload?.[0]?.payload; if (d?.di != null) selectDay(d.di) }} style={{ cursor: 'pointer' }}>
            <XAxis dataKey="day" tick={{ fill: T.text2, fontSize: fs(11), fontFamily: T.font }} interval={0} />
            <YAxis width={28} tick={{ fill: T.text2, fontSize: fs(12), fontFamily: T.font }} />
            <Tooltip {...TOOLTIP_STYLE} cursor={false} labelFormatter={(_, payload) => payload?.[0]?.payload?.fullDay || ''} formatter={(val, name) => val > 0 ? [`${val}h`, name] : [null, null]} />
            {(() => { const sel = barData.find(d => d.di === dateIdx); return sel ? <ReferenceArea x1={sel.day} x2={sel.day} fill="#ffffff" fillOpacity={0.10} ifOverflow="visible" /> : null })()}
            <Bar dataKey="good"        name="Good wind"        stackId="a" fill={C.good}       radius={[0,0,0,0]} />
            <Bar dataKey="cross"       name="Crosswind"        stackId="a" fill={C.cross}      radius={[0,0,0,0]} />
            <Bar dataKey="gusty"       name="Gusty"            stackId="a" fill={C.gusty}      radius={[0,0,0,0]} />
            <Bar dataKey="cross_gusty" name="Crosswind, Gusty" stackId="a" fill={C.crossGusty} radius={[0,0,0,0]}>
              <LabelList dataKey="label" position="top" content={({ x, y, width, value, index }) => {
                if (!value) return null
                const selected = barData[index]?.di === dateIdx
                return (
                  <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={fsc(8, '1.4vw', 10)} fontFamily={T.font}
                    fill={selected ? T.text : T.text2} fontWeight={selected ? 600 : 400}>{value}</text>
                )
              }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Certainty row */}
      {certainty && certainty.length > 0 && (
        <div data-tutorial="confidence" style={{ display: 'flex', alignItems: 'center', marginTop: 'clamp(-18px,-2.5vw,-10px)' }}>
          <div style={{ width: 28, flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', paddingRight: 8 }}>
            {barData.map((d, i) => {
              const totalHours = (d.good||0)+(d.cross||0)+(d.gusty||0)+(d.cross_gusty||0)
              const c = certainty[d.di]
              if (!c || totalHours === 0) return <div key={i} style={{ flex: 1 }} />
              const { label, color } = certLabel(c.agree, c.total)
              return (
                <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                  <span style={{ fontSize: fsc(7, '1.4vw', 10), fontWeight: 600, color, background: color+'18', padding: '2px 4px', borderRadius: 3, display: 'inline-block' }}>
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
      <div data-tutorial="gantt" style={{ background: T.card, borderRadius: 8, padding: '12px 4px', border: `1px solid ${T.borderDim}`, overflowX: 'auto', marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 12px 6px' }}>
          <label style={{ fontSize: fs(12), color: T.text2 }}>View</label>
          <select
            value={ganttMode}
            onChange={e => { const v = e.target.value; setGanttMode(v); try { localStorage.setItem('ganttMode', v) } catch {} }}
            style={{ background: T.raised, color: T.text, border: `1px solid ${T.borderEm}`, borderRadius: 5, padding: '3px 7px', fontSize: fs(12), cursor: 'pointer', fontFamily: T.font }}
          >
            <option value="locations">Locations</option>
            <option value="date">Date</option>
          </select>
        </div>
        {ganttMode === 'locations'
          ? <GanttChart ganttRows={locGanttRows} weatherRows={locWeatherRows} days={locDays} certByDay={locCertByDay} isLocations
              onDayClick={(idx) => { if (locPtMap[idx] != null) data.setPtIdx(locPtMap[idx]) }}
              dateIdx={locPtMap.indexOf(ptIdx)} effectiveTimeStart={effectiveTimeStart} effectiveTimeEnd={effectiveTimeEnd} />
          : <GanttChart ganttRows={ganttRows} weatherRows={weatherRows} days={days} certByDay={certByDay} onDayClick={selectDay} dateIdx={dateIdx} 
                      effectiveTimeStart={effectiveTimeStart} effectiveTimeEnd={effectiveTimeEnd} />
        }
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
        fontSize: fs(11), color: T.text2, lineHeight: 1.55,
        display: 'flex', alignItems: 'flex-start', gap: 8,
      }}>
        <span>{FLYABLE_DISCLAIMER}</span>
      </div>
    </div>
  )
}