import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fs, fsc } from '../fs.js'
import { T, C, _fitCanvas, fitTextSize, certLabel, wrapTextLines } from '../forecastShared.js'

const GANTT_COLOR     = { good: C.good, cross: C.cross, good_gusty: C.gusty, cross_gusty: C.crossGusty, no: 'transparent' }
const WEATHER_COLOR   = { fog: C.fog, rain: C.rain }
const TYPE_LABEL      = { good: 'Good', cross: 'Crosswind', good_gusty: 'Gusty', cross_gusty: 'Crosswind, Gusty', fog: 'Fog', rain: 'Rain' }
const TYPE_COLOR      = { good: C.good, cross: C.cross, good_gusty: C.gusty, cross_gusty: C.crossGusty, fog: C.fog, rain: C.rain }

export default function GanttChart({ ganttRows, weatherRows, days, certByDay, onDayClick, dateIdx, isLocations, effectiveTimeStart, effectiveTimeEnd, wingsConfig, wingModelName, bestWingByDay }) {
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

  const RIGHT  = 8
  const DAY_H  = Math.round(Math.max(46, Math.min(58, W * 0.115)))
  const BAR_Y  = Math.round(DAY_H * 0.27)
  const BAR_H  = Math.round(DAY_H * 0.46)
  const FS_HR  = Math.round(Math.max(9,  Math.min(11, W * 0.018)))
  const FS_DAY = Math.round(Math.max(11, Math.min(14, W * 0.024)))
  const FS_PT  = Math.round(Math.max(9,  Math.min(11, W * 0.019)))
  const FS_CRT = Math.round(Math.max(8,  Math.min(10, W * 0.016)))
  const fmtH = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` }
  const [tooltip, setTooltip] = useState(null)
  const tooltipRef = useRef(null)
  useLayoutEffect(() => {
    if (!tooltip || !tooltipRef.current || !containerRef.current) return
    const ttEl = tooltipRef.current
    const cW = containerRef.current.clientWidth
    const ttW = ttEl.offsetWidth
    let left = parseFloat(ttEl.style.left) || 0
    let top = parseFloat(ttEl.style.top) || 0
    if (left + ttW > cW) left = Math.max(0, cW - ttW - 4)
    if (top < 0) top = tooltip.y + 20
    ttEl.style.left = `${left}px`
    ttEl.style.top = `${top}px`
  }, [tooltip])

  const grouped = {}
  for (const r of ganttRows) { if (!grouped[r.day]) grouped[r.day] = []; grouped[r.day].push(r) }
  const weatherGrouped = {}
  for (const r of (weatherRows || [])) { if (!weatherGrouped[r.day]) weatherGrouped[r.day] = []; weatherGrouped[r.day].push(r) }
  const dayKeys = [...new Set(ganttRows.map(r => r.day))]

  let LEFT
  if (isLocations) {
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

  const allTimes = [
    ...ganttRows,
    ...(weatherRows || []),
  ].flatMap(r => [new Date(r.start), new Date(r.end)])

  let rawMinT, rawMaxT
  if (effectiveTimeStart && effectiveTimeEnd) {
    const effectiveStartDate = new Date(ganttRows[0]?.start || new Date())
    effectiveStartDate.setHours(...effectiveTimeStart.split(':').map(Number))
    effectiveStartDate.setMinutes(0, 0, 0)
    const effectiveEndDate = new Date(ganttRows[0]?.start || new Date())
    effectiveEndDate.setHours(...effectiveTimeEnd.split(':').map(Number))
    effectiveEndDate.setMinutes(0, 0, 0)
    rawMinT = effectiveStartDate.getTime()
    rawMaxT = effectiveEndDate.getTime()
  } else {
    rawMinT = allTimes.length ? Math.min(...allTimes.map(t => t.getTime())) : 0
    rawMaxT = allTimes.length ? Math.max(...allTimes.map(t => t.getTime())) : 1
  }

  const minT    = rawMinT - 1800_000
  const maxT    = rawMaxT
  const span = maxT - minT || 1
  const scale = (t) => LEFT + ((new Date(t).getTime() - minT) / span) * (W - LEFT - RIGHT)

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
    const step = W < 400 ? 7200_000 : 3600_000
    for (let t = start.getTime(); t <= maxT; t += step) {
      const x = scale(new Date(t))
      if (x >= LEFT - FS_HR && x < W - RIGHT) hourLabels.push({ x, label: new Date(t).getHours() + ':00' })
    }
  }

  return (
    <div ref={containerRef} style={{ width: '100%', position: 'relative' }} onClick={() => setTooltip(null)}>
      {tooltip && (() => {
        const cW = containerRef.current?.clientWidth || 700
        const left = Math.max(0, Math.min(tooltip.x, cW - 230))
        const top = tooltip.y - 60 < 0 ? tooltip.y + 20 : tooltip.y - 60
        return (
          <div ref={tooltipRef} style={{
            position: 'absolute', left, top,
            background: T.card, border: `1px solid ${T.border}`, borderRadius: 6,
            padding: '6px 10px', fontSize: fs(12), color: T.text, fontFamily: T.font,
            pointerEvents: 'none', zIndex: 10, whiteSpace: 'normal', maxWidth: 220,
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          }}>
            <div style={{ fontWeight: 600, color: TYPE_COLOR[tooltip.type] || T.text }}>{tooltip.label}</div>
            {tooltip.wings?.length > 0 && (() => {
              const maxTextW = 200
              const ctx = _fitCanvas?.getContext('2d')
              if (!ctx) return <div style={{ fontSize: fs(10), color: T.text2, marginTop: 1 }}>{tooltip.wings.join(', ')}</div>
              ctx.font = `${fs(10)}px ${T.font}`
              return <div style={{ fontSize: fs(10), color: T.text2, marginTop: 1, lineHeight: 1.4 }}>{wrapTextLines(ctx, tooltip.wings, maxTextW).map((l, i) => <div key={i}>{l}</div>)}</div>
            })()}
            <div style={{ color: T.text2, marginTop: 2 }}>{tooltip.time}</div>
          </div>
        )
      })()}
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
              {flyableRows.map((r, i) => {
                const geom = barGeom(r.start, r.end)
                const sortedWings = (r.wings || []).filter(w => w.key !== 'custom').sort((a, b) => a.size - b.size)
                const bw = bestWingByDay?.[r.day]
                const bestIsFlyable = bw && sortedWings.some(w => w.key === bw.key && w.size === bw.size)
                const wingLabel = bestIsFlyable ? `${bw.size}` : (sortedWings.length > 0 ? `${sortedWings[0].size}` : '')
                const allWingNames = sortedWings.map(w => `${wingModelName ? wingModelName(w.key, w.size) : (wingsConfig?.[w.key]?.display_name || w.key)} ${w.size}m²`)
                const wingNames = allWingNames.length > 1 ? [`${allWingNames[0]} - ${allWingNames[allWingNames.length - 1]}`] : allWingNames
                return (
                  <g key={i}>
                    <rect {...geom} y={y + BAR_Y} height={BAR_H}
                      fill={GANTT_COLOR[r.type] || '#444'} rx={2} opacity={0.88} style={{ cursor: 'pointer' }}
                      onClick={e => { e.stopPropagation(); const di = days.indexOf(day); if (onDayClick && di !== -1) onDayClick(di); setTooltip({ label: TYPE_LABEL[r.type] || r.type, type: r.type, wings: wingNames || '', time: barTime(r.start, r.end), x: geom.x, y: y + BAR_Y }) }}
                    />
                    {wingLabel && (() => {
                      const sz = fitTextSize(wingLabel, geom.width - 4, fs(Math.min(W < 400 ? 9 : 11, BAR_H - 2)))
                      if (!sz) return null
                      return (
                        <text
                          x={geom.x + geom.width / 2}
                          y={y + BAR_Y + BAR_H / 2 + 1}
                          textAnchor="middle" dominantBaseline="central"
                          fontSize={sz}
                          fill="rgba(0,0,0,0.75)" fontWeight={700}
                          style={{ pointerEvents: 'none' }}
                        >
                          {wingLabel}
                        </text>
                      )
                    })()}
                  </g>
                )
              })}
              {wRows.map((r, i) => (
                <rect key={'w' + i} {...barGeom(r.start, r.end)} y={y + BAR_Y} height={BAR_H}
                  fill={WEATHER_COLOR[r.type] || '#666'} rx={2} opacity={0.6} style={{ cursor: 'pointer' }}
                  onClick={e => { e.stopPropagation(); const di = days.indexOf(day); if (onDayClick && di !== -1) onDayClick(di); setTooltip({ label: TYPE_LABEL[r.type] || r.type, type: r.type, wings: [], time: barTime(r.start, r.end), x: barGeom(r.start, r.end).x, y: y + BAR_Y }) }}
                />
              ))}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
