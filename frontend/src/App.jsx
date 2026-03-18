import React, { useState } from 'react'
import { useSoarData } from './hooks/useSoarData.js'
import MapForecast, { certLabel } from './components/MapForecast.jsx'
import PointForecast from './components/PointForecast.jsx'
import Settings      from './components/Settings.jsx'
import Info          from './components/Info.jsx'
import Tutorial      from './components/Tutorial.jsx'

// Inject Inter font once
if (typeof document !== 'undefined' && !document.getElementById('soar-inter')) {
  const link = document.createElement('link')
  link.id   = 'soar-inter'
  link.rel  = 'stylesheet'
  link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap'
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
  font:      "'DM Sans', system-ui, sans-serif",
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
    fontSize: 14,
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
    fontSize: 18,
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
    fontSize: 12,
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
    fontSize: 13,
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
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: T.font,
  },
  label: { fontSize: 12, color: T.text2 },
  pill: (color, bg) => ({
    padding: '2px 8px',
    borderRadius: 20,
    fontSize: 11,
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
  const { status, days, loading, error, dateIdx, setDateIdx, certainty, model, appConfig } = data

  if (loading) return (
    <div style={s.app}>
      <div style={s.center}>
        <img src="/paraglider_small.png" width={44} height={44} alt="" />
        <span style={{ fontSize: 13 }}>Loading Soaralarm NL…</span>
      </div>
    </div>
  )

  if (error) return (
    <div style={s.app}>
      <div style={s.center}>
        <I8 name="error" size={36} color="d64040" />
        <span>Could not reach API: {error}</span>
        <span style={{ fontSize: 12 }}>Make sure the FastAPI backend is running on port 8000</span>
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
      <Tutorial activeTab={activeTab} onSwitchTab={setActiveTab} />

      {/* ── Tab bar ── */}
      <nav style={s.tabBar}>
        {TABS.map((t, i) => (
          <button key={t.label} style={s.tab(activeTab === i)} onClick={() => setActiveTab(i)}>
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
        <div style={s.controls}>
          <span style={s.label}>Date</span>
          <select
            style={s.select}
            value={dateIdx}
            onChange={e => setDateIdx(Number(e.target.value))}
          >
            {days.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>

          <span style={{ fontSize: 11, color: T.text3, borderLeft: `1px solid ${T.borderDim}`, paddingLeft: 10 }}>
            {appConfig?.mode_name ?? ''} · {appConfig?.country_name ?? ''} · {data.models?.[model]?.display_name ?? model}
          </span>

          {/* Confidence + weather pills */}
          {(() => {
            const c = certainty?.[dateIdx]
            if (!c) return null
            const dayBar = data.displayForecast?.[dateIdx]
            const hasFly = dayBar?.some(pf =>
              (pf.good_hours + pf.cross_hours + pf.gusty_hours + pf.cross_gusty_hours) > 0
            )
            if (!hasFly) return null
            const { label, color } = certLabel(c.agree, c.total)
            const bestPf = dayBar?.[c.best_pi ?? 0]
            return (
              <>
                <span style={s.pill(color, color + '1a')}>{label}</span>
                {bestPf?.has_rain && <span style={s.pill('#3a7bd5', '#4a8fd41a')}>Rain</span>}
                {bestPf?.has_fog  && <span style={s.pill('#8888aa', '#8888aa1a')}>Fog</span>}
              </>
            )
          })()}

          {status?.forecast_age_seconds != null && (
            <span style={{ fontSize: 11, color: T.text3, marginLeft: 'auto' }}>
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
      <div style={{ fontSize: 13 }}>Fetching forecast data…</div>
    </div>
  )
}
