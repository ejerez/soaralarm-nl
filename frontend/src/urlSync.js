const DAY_SLUGS = ['yesterday', 'today', 'tomorrow', 'day-3', 'day-4', 'day-5', 'day-6', 'day-7']

export function slugifyPoint(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export { DAY_SLUGS }

export function buildUrl(tab, dateIdx, ptIdx, points) {
  if (tab === 2) return '/settings'
  if (tab === 3) return '/info'
  const day = DAY_SLUGS[dateIdx] || `day-${dateIdx}`
  if (tab === 1 && points?.[ptIdx]) {
    return `/${day}/${slugifyPoint(points[ptIdx].name)}`
  }
  return `/${day}`
}

export function parseUrl(pathname, points) {
  const path = pathname.replace(/^\/|\/$/g, '')
  if (!path) return null

  const parts = path.split('/')

  if (parts[0] === 'settings') return { tab: 2 }
  if (parts[0] === 'info') return { tab: 3 }

  const dayIdx = DAY_SLUGS.indexOf(parts[0])
  if (dayIdx === -1) return null

  if (parts.length === 1) return { tab: 0, dateIdx: dayIdx }

  if (parts.length === 2 && points?.length) {
    const slug = parts[1]
    const ptIdx = points.findIndex(p => slugifyPoint(p.name) === slug)
    if (ptIdx !== -1) return { tab: 1, dateIdx: dayIdx, ptIdx }
  }

  return { tab: 0, dateIdx: dayIdx }
}
