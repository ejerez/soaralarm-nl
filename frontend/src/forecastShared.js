import { fs, fsc } from './fs.js'

export const T = {
  bg:        '#1a1a1a',
  surface:   '#262626',
  card:      '#262626',
  raised:    '#2e2e2e',
  borderDim: '#353535',
  border:    '#3d3d3d',
  text:      '#dedede',
  text2:     '#9a9a9a',
  text3:     '#757575',
  accent:    '#5578e8',
  font:      "'Atkinson Hyperlegible', system-ui, sans-serif",
}

export const C = {
  good:        '#1dbb02',
  cross:       '#ddb60a',
  gusty:       '#d67900',
  crossGusty:  '#c12e0d',
  rain:        '#1b8fe2',
  fog:         '#8888a0',
}

export const _fitCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null

export function fitTextSize(text, maxWidth, maxSize, fontWeight = 700, fontFamily = T.font) {
  if (!text || maxWidth <= 0 || !_fitCanvas) return maxSize
  const ctx = _fitCanvas.getContext('2d')
  let s = maxSize
  while (s > 5) {
    ctx.font = `${fontWeight} ${s}px ${fontFamily}`
    if (ctx.measureText(text).width <= maxWidth) break
    s -= 0.5
  }
  return s < 6 ? 0 : s
}

export function certLabel(agree, total) {
  if (agree === 4) return { label: '★★★★', color: '#00e6bc' }
  if (agree === 3) return { label: '★★★',      color: '#00ef3c' }
  if (agree === 2) return { label: '★★',    color: '#dbff26' }
  return                  { label: '★',       color: '#d3357c' }
}

const DAY_SHORT = {
  Yesterday: 'Yest.', Today: 'Today', Tomorrow: 'Tomr.',
  Monday: 'Mon.', Tuesday: 'Tue.', Wednesday: 'Wed.',
  Thursday: 'Thu.', Friday: 'Fri.', Saturday: 'Sat.', Sunday: 'Sun.',
}
export function shortenDay(d) { return DAY_SHORT[d] ?? d }

export function parseWingSetKey(wsKey) {
  return wsKey.split(',').map(ws => {
    const colonIdx = ws.lastIndexOf(':')
    const key = ws.slice(0, colonIdx)
    const size = Number(ws.slice(colonIdx + 1))
    if (key === 'custom') return null
    return { key, size }
  }).filter(Boolean).sort((a, b) => a.size - b.size)
}

export function clampGanttToWindow(g, effectiveTimeStart, effectiveTimeEnd) {
  const sDate = g.start.slice(0, 10)
  const winStart = effectiveTimeStart !== '00:00' ? new Date(`${sDate}T${effectiveTimeStart}`).getTime() : -Infinity
  const winEnd   = effectiveTimeEnd !== '23:59'  ? new Date(`${sDate}T${effectiveTimeEnd}`).getTime()   :  Infinity
  const gStart = new Date(g.start).getTime()
  const gEnd   = new Date(g.end).getTime() || gStart
  if (gEnd <= winStart || gStart > winEnd) return null
  return {
    ...g,
    start: gStart < winStart          ? new Date(winStart).toISOString()              : g.start,
    end:   gEnd > winEnd + 3600_000   ? new Date(winEnd + 3600_000).toISOString()     : g.end,
  }
}

export function wingSetShortLabel(wsKey) {
  const items = parseWingSetKey(wsKey)
  return items.length > 0 ? `${items[0].size}` : ''
}

export function wingSetFullLabel(wsKey, wingModelName) {
  const labels = parseWingSetKey(wsKey).map(({ key, size }) =>
    `${wingModelName(key, size)} ${size}m²`
  )
  return labels.length > 1 ? [`${labels[0]} - ${labels[labels.length - 1]}`] : labels
}

export function wrapTextLines(ctx, words, maxTextW) {
  const lines = []
  let cur = []
  for (const w of words) {
    const candidate = cur.length === 0 ? w : cur.join(', ') + ', ' + w
    if (ctx.measureText(candidate).width <= maxTextW) {
      cur.push(w)
    } else {
      if (cur.length > 0) lines.push(cur.join(', '))
      cur = [w]
    }
  }
  if (cur.length > 0) lines.push(cur.join(', '))
  return lines
}
