import React, { useCallback, useEffect, useRef, useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, LabelList, ReferenceArea } from 'recharts'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { fs, fsc } from '../fs.js'
import { compareLocations, findBestLocationIndex } from '../locationSort.js'
import GanttChart from './GanttChart.jsx'
import { T, C, fitTextSize, certLabel, shortenDay, parseWingSetKey, clampGanttToWindow, wingSetFullLabel } from '../forecastShared.js'

const DEG = Math.PI / 180
function toRad(d) { return d * DEG }

// ── Map wind polygons ────────────────────────────────────────────────────────
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

const FLYABLE_DISCLAIMER = "The forecasts and flyability calculations are not infallible. Always verify that the actual conditions are appropriate for your exact wing model, skill level, physical ability and risk tolerance before attempting to fly. See the Info tab for details on how flyability is calculated."

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

const QUALITIES = [
  { key: 'good', name: 'Good wind', color: C.good },
  { key: 'cross', name: 'Crosswind', color: C.cross },
  { key: 'gusty', name: 'Gusty', color: C.gusty },
  { key: 'cross_gusty', name: 'Crosswind, Gusty', color: C.crossGusty },
]

export default function MapForecast({ data, onNavigateToPoint }) {
  const { displayForecast, certainty, points, days, dateIdx, setDateIdx, ptIdx, timeStart, timeEnd, effectiveTimeStart, effectiveTimeEnd, wings, selectedWings } = data

  const [plotDays,     setPlotDays]     = useState(() => { try { return Number(localStorage.getItem('plotDays')) || 5 } catch { return 5 } })
  const [showYesterday, setShowYesterday] = useState(() => { try { return localStorage.getItem('showYesterday') === 'true' } catch { return false } })
  const [ganttMode, setGanttMode] = useState(() => { try { return localStorage.getItem('ganttMode') || 'locations' } catch { return 'locations' } })

  const wingModelName = useCallback((key, size) => {
    const sw = (selectedWings || []).find(w => w.key === key && w.size === size)
    return sw?.model || wings?.[key]?.display_name || key
  }, [selectedWings, wings])

  const mapRef     = useRef(null)
  const leafletRef = useRef(null)
  const layersRef  = useRef([])
  const markersRef = useRef([])
  const radarRef   = useRef(null)
  const ptIdxRef   = useRef(ptIdx)
  ptIdxRef.current = ptIdx

  const isMobile   = typeof window !== 'undefined' && window.innerWidth < 500
  const baseRadius = isMobile ? 3 : 5
  const selRadius  = isMobile ? 5 : 7

  const pointsBounds = useMemo(() => {
    if (!points.length) return null
    const lats = points.map(p => p.lat)
    const lons = points.map(p => p.lon)
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

  useEffect(() => {
    if (leafletRef.current && pointsBounds) {
      leafletRef.current.fitBounds(pointsBounds, { animate: true })
    }
  }, [pointsBounds])

  // ── Rain radar overlay with animation ────────────────────────────────────
  const isToday = days[dateIdx] === 'Today'
  const rainTiles = data.measurements?.rain_tiles
  const [animateRadar, setAnimateRadar] = useState(true)
  const [currentTileIndex, setCurrentTileIndex] = useState(0)
  const sortedTilesRef = useRef([])

  useEffect(() => {
    const map = leafletRef.current
    if (!map || !isToday || !rainTiles?.length) return

    if (!map.getPane('radarPane')) {
      map.createPane('radarPane')
      map.getPane('radarPane').style.zIndex = 250
    }

    if (radarRef.current) { radarRef.current.remove(); radarRef.current = null }

    if (!animateRadar || rainTiles.length <= 1) {
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

    const sortedTiles = [...rainTiles].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    const tilesWithDynamicAge = sortedTiles.map(tile => ({
      ...tile,
      timestamp: tile.timestamp || Date.now(),
      dynamicAge: Math.floor((Date.now() - (tile.timestamp || Date.now())) / 60000)
    }))
    sortedTilesRef.current = tilesWithDynamicAge

    const sequence = tilesWithDynamicAge.map((_, index) => index)
    const timings = sequence.map((_, index) => index === sequence.length - 1 ? 3000 : 500)

    let timeoutId = null
    let sequenceIndex = 0

    const runAnimationStep = () => {
      setCurrentTileIndex(sequence[sequenceIndex])
      const nextIndex = (sequenceIndex + 1) % sequence.length
      timeoutId = setTimeout(runAnimationStep, timings[sequenceIndex])
      sequenceIndex = nextIndex
    }

    timeoutId = setTimeout(runAnimationStep, timings[0])

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      if (radarRef.current) { radarRef.current.remove(); radarRef.current = null }
    }
  }, [isToday, rainTiles, animateRadar])

  useEffect(() => {
    const map = leafletRef.current
    if (!map || !isToday || !rainTiles?.length || rainTiles.length <= 1) return

    if (radarRef.current) { radarRef.current.remove(); radarRef.current = null }

    const tilesWithDynamicAge = sortedTilesRef.current
    const tile = tilesWithDynamicAge[currentTileIndex]
    if (tile?.image && tile?.bounds) {
      const overlay = L.imageOverlay(tile.image, tile.bounds, {
        opacity: 0.55,
        pane: 'radarPane',
      })
      overlay.addTo(map)
      radarRef.current = overlay
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
    const curPt = ptIdxRef.current
    markersRef.current.forEach(({ marker, color }, i) => {
      const selected = i === curPt
      marker.setRadius(selected ? selRadius : baseRadius)
      marker.setStyle({ color: selected ? '#000000' : color, weight: selected ? 3 : 2 })
      if (selected) marker.bringToFront()
    })
  }, [displayForecast, points, dateIdx])

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

  // ── Bar data memo ──────────────────────────────────────────────────────────
  const { barData, certByDay, weatherByDay, bestWingByDay, ganttRows, weatherRows } = useMemo(() => {
    if (!displayForecast || !points.length) return { barData: [], certByDay: {}, weatherByDay: {}, bestWingByDay: {}, ganttRows: [], weatherRows: [] }

    const bar = [], gantt = [], weather = [], certByDayMap = {}, weatherByDayMap = {}, bestWingByDayMap = {}
    const maxDi = plotDays

    displayForecast.forEach((dayPf, di) => {
      if (di === 0 && !showYesterday) return
      if (di > maxDi) return
      const certDi = certainty?.[di]
      const best = findBestLocationIndex(dayPf, certDi, points)
      const bpf = dayPf[best], bpt = points[best]
      const bestAgree = certDi?.by_point?.[best] ?? certDi?.agree ?? 0
      bar.push({
        day: shortenDay(days[di] || `Day ${di}`),
        fullDay: days[di] || `Day ${di}`,
        di,
        good: bpf?.good_hours || 0, cross: bpf?.cross_hours || 0,
        gusty: bpf?.gusty_hours || 0, cross_gusty: bpf?.cross_gusty_hours || 0,
        wingSetHours: bpf?.wing_set_hours || {},
        bestWing: bpf?.best_wing || null,
        label: ((bpf?.good_hours||0)+(bpf?.cross_hours||0)+(bpf?.gusty_hours||0)+(bpf?.cross_gusty_hours||0)) > 0 ? (bpt?.name||'') : '',
        agree: bestAgree, total: certDi?.total ?? 0,
      })
      const dayName  = days[di] || `Day ${di}`
      const shortDay = shortenDay(dayName)
      bestWingByDayMap[dayName] = bpf?.best_wing || null
      if (certDi) certByDayMap[dayName] = { ...certDi, agree: bestAgree }
      weatherByDayMap[shortDay] = { has_fog: dayPf.some(pf => pf.has_fog), has_rain: dayPf.some(pf => pf.has_rain) }
      if (bpf?.gantt) bpf.gantt.forEach(g => {
        const c = clampGanttToWindow({ ...g, day: dayName, point: bpt?.name||'' }, effectiveTimeStart, effectiveTimeEnd)
        if (c) gantt.push(c)
      })
      const bestFly = (bpf?.good_hours||0) + (bpf?.cross_hours||0) + (bpf?.gusty_hours||0) + (bpf?.cross_gusty_hours||0)
      if (bestFly > 0 && bpf?.fog_gantt) bpf.fog_gantt.forEach(g => {
        const c = clampGanttToWindow({ ...g, day: dayName }, effectiveTimeStart, effectiveTimeEnd)
        if (c) weather.push(c)
      })
      if (bestFly > 0 && bpf?.rain_gantt) bpf.rain_gantt.forEach(g => {
        const c = clampGanttToWindow({ ...g, day: dayName }, effectiveTimeStart, effectiveTimeEnd)
        if (c) weather.push(c)
      })
    })

    return { barData: bar, certByDay: certByDayMap, weatherByDay: weatherByDayMap, bestWingByDay: bestWingByDayMap, ganttRows: gantt, weatherRows: weather }
  }, [displayForecast, points, days, certainty, plotDays, showYesterday, effectiveTimeStart, effectiveTimeEnd])

  // ── Locations data memo ───────────────────────────────────────────────────
  const { locGanttRows, locWeatherRows, locCertByDay, locDays, locPtMap, locBestWingByDay } = useMemo(() => {
    if (!displayForecast || !points.length) return { locGanttRows: [], locWeatherRows: [], locCertByDay: {}, locDays: [], locPtMap: [], locBestWingByDay: {} }

    const locGantt = [], locWeather = [], locCertMap = {}, locDays = [], locPtMap = [], locBestWingMap = {}
    const dayPf = displayForecast[dateIdx] || []
    const certDay = certainty?.[dateIdx]
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
      locBestWingMap[ptName] = pf.best_wing || null
      if (pf.gantt) pf.gantt.forEach(g => {
        const c = clampGanttToWindow({ ...g, day: ptName, point: '' }, effectiveTimeStart, effectiveTimeEnd)
        if (c) locGantt.push(c)
      })
      if (pf.fog_gantt) pf.fog_gantt.forEach(g => {
        const c = clampGanttToWindow({ ...g, day: ptName }, effectiveTimeStart, effectiveTimeEnd)
        if (c) locWeather.push(c)
      })
      if (pf.rain_gantt) pf.rain_gantt.forEach(g => {
        const c = clampGanttToWindow({ ...g, day: ptName }, effectiveTimeStart, effectiveTimeEnd)
        if (c) locWeather.push(c)
      })
    })

    return { locGanttRows: locGantt, locWeatherRows: locWeather, locCertByDay: locCertMap, locDays, locPtMap, locBestWingByDay: locBestWingMap }
  }, [displayForecast, points, dateIdx, certainty, effectiveTimeStart, effectiveTimeEnd])

  // ── Wing set keys ──────────────────────────────────────────────────────────
  const allWingSetKeys = useMemo(() => {
    const keys = new Set()
    barData.forEach(d => {
      Object.keys(d.wingSetHours || {}).forEach(k => {
        if (!k.includes('custom')) keys.add(k)
      })
    })
    return [...keys].sort()
  }, [barData])

  // ── Flat bar data for wing-set mode ────────────────────────────────────────
  const flatBarData = useMemo(() => {
    return barData.map(d => {
      const flat = { ...d, _topLabel: 0 }
      allWingSetKeys.forEach(wsKey => {
        const wsHours = d.wingSetHours?.[wsKey] || {}
        flat[`good__${wsKey}`] = wsHours.good || 0
        flat[`cross__${wsKey}`] = wsHours.cross || 0
        flat[`gusty__${wsKey}`] = wsHours.good_gusty || 0
        flat[`cross_gusty__${wsKey}`] = wsHours.cross_gusty || 0
      })
      return flat
    })
  }, [barData, allWingSetKeys])

  // ── Bar metadata for tooltips ──────────────────────────────────────────────
  const barMeta = useMemo(() => {
    const map = {}
    QUALITIES.forEach(q => {
      allWingSetKeys.forEach(wsKey => {
        map[`${q.key}__${wsKey}`] = {
          qualityName: q.name,
          qualityColor: q.color,
          wingLabel: wingSetFullLabel(wsKey, wingModelName),
        }
      })
    })
    return map
  }, [allWingSetKeys, wings, selectedWings])

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
            style={{ background: T.raised, color: T.text, border: `1px solid ${T.border}`, borderRadius: 5, padding: '3px 7px', fontSize: fs(12), cursor: 'pointer', fontFamily: T.font }}
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
      <div data-tutorial="barchart" style={{ position: 'relative', overflow: 'visible', WebkitTapHighlightColor: 'transparent' }}>
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
          <BarChart data={allWingSetKeys.length > 0 ? flatBarData : barData} margin={{ top: 40, right: 8, left: 0, bottom: 0 }} onClick={e => { const d = e?.activePayload?.[0]?.payload; if (d?.di != null) selectDay(d.di) }} style={{ cursor: 'pointer' }}>
            <XAxis dataKey="day" tick={{ fill: T.text2, fontSize: fs(11), fontFamily: T.font }} interval={0} />
            <YAxis width={28} allowDecimals={false} tick={{ fill: T.text2, fontSize: fs(12), fontFamily: T.font }} />
            <Tooltip {...TOOLTIP_STYLE} cursor={false} allowEscapeViewBox={{ x: false, y: false }}
              content={({ payload, label }) => {
                if (!payload?.length) return null
                const fullDay = payload[0]?.payload?.fullDay || label
                const entries = payload
                  .filter(p => p.value > 0 && barMeta[p.dataKey])
                  .map(p => {
                    const m = barMeta[p.dataKey]
                    return { hours: p.value, ...m }
                  })
                if (!entries.length) return null
                return (
                  <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: fs(12), fontFamily: T.font, padding: '6px 10px', boxShadow: '0 2px 8px rgba(0,0,0,0.4)', maxWidth: 280 }}>
                    <div style={{ color: T.text2, marginBottom: 4 }}>{fullDay}</div>
                    {entries.map((e, i) => (
                      <div key={i} style={{ marginBottom: i < entries.length - 1 ? 4 : 0 }}>
                        <span style={{ color: e.qualityColor || T.text, fontWeight: 600 }}>{e.hours}h {e.qualityName}</span>
                        {e.wingLabel?.length > 0 && (
                          <div style={{ fontSize: fs(10), color: T.text2, lineHeight: 1.4, marginTop: 2 }}>
                            {e.wingLabel.map((l, j) => <div key={j}>{l}</div>)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              }}
            />
            {(() => { const sel = barData.find(d => d.di === dateIdx); return sel ? <ReferenceArea x1={sel.day} x2={sel.day} fill="#ffffff" fillOpacity={0.10} ifOverflow="visible" /> : null })()}
            {allWingSetKeys.length > 0 ? (
              <>
                {QUALITIES.flatMap(q =>
                  allWingSetKeys.map(wsKey => (
                    <Bar
                      key={`${q.key}__${wsKey}`}
                      dataKey={`${q.key}__${wsKey}`}
                      stackId="a"
                      fill={q.color}
                      radius={[0, 0, 0, 0]}
                      legendType="none"
                      label={(props) => {
                        const { x, y, width, height, value, index } = props
                        if (!value || height < 14) return null
                        const items = parseWingSetKey(wsKey)
                        const bw = barData[index]?.bestWing
                        let label = ''
                        if (bw && items.some(item => item.key === bw.key && item.size === bw.size)) {
                          label = `${bw.size}`
                        } else if (items.length > 0) {
                          label = `${items[0].size}`
                        }
                        if (!label) return null
                        const sz = fitTextSize(label, width - 4, Math.min(11, height - 2))
                        if (sz < 6) return null
                        return (
                          <text x={x + width / 2} y={y + height / 2}
                            textAnchor="middle" dominantBaseline="central"
                            fontSize={sz}
                            fill="rgba(0,0,0,0.75)" fontWeight={700}
                            fontFamily={T.font}>
                            {label}
                          </text>
                        )
                      }}
                    />
                  ))
                )}
                <Bar dataKey="_topLabel" stackId="a" fill="transparent" legendType="none"
                  label={{ position: 'top', content: ({ x, y, width, index }) => {
                    const d = barData[index]
                    if (!d?.label) return null
                    const selected = d.di === dateIdx
                    return (
                      <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={fsc(8, '1.4vw', 10)} fontFamily={T.font}
                        fill={selected ? T.text : T.text2} fontWeight={selected ? 600 : 400}>{d.label}</text>
                    )
                  }}} />
              </>
            ) : (
              <>
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
              </>
            )}
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
              if (!d.total || totalHours === 0) return <div key={i} style={{ flex: 1 }} />
              const { label, color } = certLabel(d.agree, d.total)
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
            style={{ background: T.raised, color: T.text, border: `1px solid ${T.border}`, borderRadius: 5, padding: '3px 7px', fontSize: fs(12), cursor: 'pointer', fontFamily: T.font }}
          >
            <option value="locations">Locations</option>
            <option value="date">Date</option>
          </select>
        </div>
        {ganttMode === 'locations'
          ? <GanttChart ganttRows={locGanttRows} weatherRows={locWeatherRows} days={locDays} certByDay={locCertByDay} isLocations
              onDayClick={(idx) => { if (locPtMap[idx] != null) data.setPtIdx(locPtMap[idx]) }}
              dateIdx={locPtMap.indexOf(ptIdx)} effectiveTimeStart={effectiveTimeStart} effectiveTimeEnd={effectiveTimeEnd} wingsConfig={wings} wingModelName={wingModelName} bestWingByDay={locBestWingByDay} />
          : <GanttChart ganttRows={ganttRows} weatherRows={weatherRows} days={days} certByDay={certByDay} onDayClick={selectDay} dateIdx={dateIdx}
              effectiveTimeStart={effectiveTimeStart} effectiveTimeEnd={effectiveTimeEnd} wingsConfig={wings} wingModelName={wingModelName} bestWingByDay={bestWingByDay} />
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

export { certLabel }
