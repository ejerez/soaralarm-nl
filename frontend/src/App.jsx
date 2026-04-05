import React, { useState, useEffect } from 'react'
import { fs } from './fs.js'
import { useSoarData } from './hooks/useSoarData.js'
import MapForecast, { certLabel } from './components/MapForecast.jsx'
import PointForecast from './components/PointForecast.jsx'
import Settings      from './components/Settings.jsx'
import Info          from './components/Info.jsx'
import Tutorial      from './components/Tutorial.jsx'
import WhatsNew      from './components/WhatsNew.jsx'
import TermsAndConditions from './components/TermsAndConditions.jsx'

// Inject fonts once
if (typeof document !== 'undefined' && !document.getElementById('soar-fonts')) {
  const link = document.createElement('link')
  link.id   = 'soar-fonts'
  link.rel  = 'stylesheet'
  link.href = 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap'
  document.head.appendChild(link)
}

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  bg:        '#1a1a1a',
  surface:   '#262626',
  card:      '#262626',
  raised:    '#2e2e2e',
  borderDim: '#353535',
  border:    '#3d3d3d',
  borderEm:  '#484848',
  text:      '#dedede',
  text2:     '#9a9a9a',
  text3:     '#757575',
  accent:    '#5578e8',
  accentBg:  'rgba(85,120,232,0.12)',
  font:      "'Atkinson Hyperlegible', system-ui, sans-serif",
}

function I8({ name, size = 16, color = '5e5e7a', style: s = {} }) {
  return (
    <img
      src={`https://img.icons8.com/ios-filled/${size * 2}/${color}/${name}.png`}
      width={size} height={size}
      style={{ display: 'inline-block', verticalAlign: 'middle', ...s }}
      alt=""
    />
  )
}

const TABS = [
  { label: 'Map',         icon: 'map'      },
  { label: 'Point',       icon: 'marker'   },
  { label: 'Settings',    icon: 'settings' },
  { label: 'Info',        icon: 'info'     },
]

const s = {
  app: {
    minHeight: '100vh',
    background: T.bg,
    color: T.text,
    fontFamily: T.font,
    fontSize: fs(14),
  },
  header: {
    padding: '18px 20px 0',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
    marginBottom: 16,
  },
  title: {
    fontSize: fs(18),
    fontWeight: 700,
    color: T.text,
    letterSpacing: '-0.3px',
    margin: 0,
  },
  statusDot: (color) => ({
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: color,
    display: 'inline-block',
    marginRight: 5,
    verticalAlign: 'middle',
    flexShrink: 0,
  }),
  statusText: {
    fontSize: fs(12),
    color: T.text2,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  tabBar: {
    display: 'flex',
    borderBottom: `1px solid ${T.borderDim}`,
    position: 'sticky',
    top: 0,
    zIndex: 100,
    background: T.bg,
    padding: '0 20px',
    gap: 0,
  },
  tab: (active) => ({
    padding: '10px 14px',
    border: 'none',
    borderBottom: active ? `2px solid ${T.accent}` : '2px solid transparent',
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
    fontSize: fs(13),
    background: 'transparent',
    color: active ? T.text : T.text2,
    fontFamily: T.font,
    transition: 'color 0.15s, border-color 0.15s',
    marginBottom: -1,
    display: 'flex',
    alignItems: 'center',
    gap: 5,
  }),
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 20px',
    background: T.surface,
    borderBottom: `1px solid ${T.borderDim}`,
    flexWrap: 'wrap',
  },
  select: {
    background: T.raised,
    color: T.text,
    border: `1px solid ${T.borderEm}`,
    borderRadius: 6,
    padding: '5px 10px',
    fontSize: fs(13),
    cursor: 'pointer',
    fontFamily: T.font,
  },
  label: { fontSize: fs(12), color: T.text2 },
  pill: (color, bg) => ({
    padding: '2px 8px',
    borderRadius: 20,
    fontSize: fs(11),
    fontWeight: 600,
    color,
    background: bg,
    letterSpacing: '0.01em',
  }),
  content: { padding: '16px 20px' },
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '50vh',
    gap: 12,
    color: T.text2,
  },
}

export default function App() {
  const [activeTab, setActiveTab] = useState(0)
  const data = useSoarData()
  const { status, days, loading, error, dateIdx, setDateIdx, certainty, model, setModel, models, refetchDisplay, countries, modes, country, mode, ptIdx, altFont, largeFont, outdoorsMode, autoModelSelection, defaultModelByDay } = data

  // Apply preference overrides globally via injected <style>
  useEffect(() => {
    let style = document.getElementById('soar-prefs')
    if (!style) {
      style = document.createElement('style')
      style.id = 'soar-prefs'
      document.head.appendChild(style)
    }
    const rules = []
    if (altFont) rules.push(
      `* { font-family: 'DM Sans', system-ui, sans-serif !important; }`,
    )
    // Atkinson has smaller glyphs than DM Sans, so base scale is 1.15.
    // Large font adds +0.25 on top of either base.
    const scale = (altFont ? 1.0 : 1.05) + (largeFont ? 0.25 : 0)
    document.documentElement.style.setProperty('--fs', scale)
    if (outdoorsMode) rules.push(
      `#root { filter: contrast(1.5) brightness(1.15) saturate(1.3); }`,
      `.leaflet-container { filter: contrast(0.67) brightness(0.87) saturate(0.77); }`,
      `.leaflet-tile-pane { filter: brightness(0.5) contrast(1.15); }`,
      `.leaflet-marker-pane, .leaflet-overlay-pane, .leaflet-popup-pane { filter: contrast(1.6) saturate(1.7) brightness(1.3); }`,
      `* { text-shadow: 0 0 1px rgba(0,0,0,0.6); }`,
    )
    style.textContent = rules.join('\n')
  }, [altFont, largeFont, outdoorsMode])

  if (loading) return (
    <div style={s.app}>
      <div style={s.center}>
        <img src="/paraglider_small.png" width={44} height={44} alt="" />
        <span style={{ fontSize: fs(13) }}>Loading Soaralarm…</span>
      </div>
    </div>
  )

  if (error) return (
    <div style={s.app}>
      <div style={s.center}>
        <I8 name="error" size={36} color="d64040" />
        <span>Could not reach API: {error}</span>
        <span style={{ fontSize: fs(12) }}>Make sure the FastAPI backend is running on port 8000</span>
      </div>
    </div>
  )

  const forecastReady = !!data.displayForecast

  // Status indicators — show only what's actually happening
  const statusItems = []
  if (status?.updating_forecast)     statusItems.push({ color: '#e6a817', label: 'Updating forecast' })
  if (status?.updating_measurements) statusItems.push({ color: '#3a7bd5', label: 'Updating measurements' })
  if (!status?.updating_forecast && status?.forecast_available && !data.displayForecast)
    statusItems.push({ color: '#e6a817', label: 'Loading forecast' })
  if (!status?.updating_forecast && !status?.forecast_available)
    statusItems.push({ color: '#ef5350', label: 'No forecast data' })

  return (
    <div style={s.app}>
      <TermsAndConditions />
      <WhatsNew />
      <Tutorial activeTab={activeTab} onSwitchTab={setActiveTab} />

      {/* ── Tab bar ── */}
      <nav style={s.tabBar}>
        {TABS.map((t, i) => (
          <button key={t.label} data-tutorial={`tab-${t.label.toLowerCase()}`} style={s.tab(activeTab === i)} onClick={() => setActiveTab(i)}>
            <I8
              name={t.icon}
              size={13}
              color={activeTab === i ? '5578e8' : '5e5e7a'}
            />
            {t.label}
          </button>
        ))}
      </nav>

      {/* ── Date / model bar ── */}
      {activeTab < 2 && (
        <div data-tutorial="pt-header" style={s.controls}>
          <select
            style={s.select}
            value={dateIdx}
            onChange={e => setDateIdx(Number(e.target.value))}
          >
            {days.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>

          {autoModelSelection ? (
            <span style={{ ...s.select, cursor: 'default', opacity: 0.8 }}>
              {models[defaultModelByDay[dateIdx]]?.display_name || '—'}
            </span>
          ) : (
            <select
              style={s.select}
              value={model}
              onChange={e => { setModel(e.target.value); refetchDisplay() }}
            >
              {Object.entries(models).map(([key, m]) => (
                <option key={key} value={key}>{m.display_name}</option>
              ))}
            </select>
          )}

          <span style={{ fontSize: fs(11), color: T.text3, paddingLeft: 10 }}>
            {countries?.[country]?.name ?? country} | {modes?.[mode] ?? mode}
          </span>

          {/* Confidence + weather pills */}
          {(() => {
            const c = certainty?.[dateIdx]
            if (!c) return null
            const dayBar = data.displayForecast?.[dateIdx]
            const selPf = dayBar?.[ptIdx]
            const selFly = selPf ? (selPf.good_hours + selPf.cross_hours + selPf.gusty_hours + selPf.cross_gusty_hours) : 0
            if (selFly === 0) return null
            const agree = c.by_point?.[ptIdx] ?? c.agree
            const { label, color } = certLabel(agree, c.total)
            return (
              <>
                <span style={s.pill(color, color + '1a')}>{label}</span>
                {selPf?.has_rain && <span style={s.pill('#3a7bd5', '#4a8fd41a')}>Rain</span>}
                {selPf?.has_fog  && <span style={s.pill('#8888aa', '#8888aa1a')}>Fog</span>}
              </>
            )
          })()}

          {status?.forecast_age_seconds != null && (
            <span style={{ fontSize: fs(11), color: T.text3, marginLeft: 'auto' }}>
              Forecast updated {Math.round(status.forecast_age_seconds / 60)} min ago
            </span>
          )}
        </div>
      )}

      {/* ── Content ── */}
      <main style={s.content}>
        {activeTab === 0 && (forecastReady ? <MapForecast data={data} onNavigateToPoint={() => setActiveTab(1)} /> : <LoadingPanel />)}
        {activeTab === 1 && (forecastReady ? <PointForecast data={data} /> : <LoadingPanel />)}
        {activeTab === 2 && <Settings data={data} />}
        {activeTab === 3 && <Info data={data} />}
      </main>
    </div>
  )
}

function LoadingPanel() {
  return (
    <div style={{ textAlign: 'center', padding: '64px 20px', color: '#888888' }}>
      <img src="/paraglider_small.png" width={44} height={44} alt="" style={{ marginBottom: 12 }} />
      <div style={{ fontSize: fs(13) }}>Fetching forecast data…</div>
    </div>
  )
}
