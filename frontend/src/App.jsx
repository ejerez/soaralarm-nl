import React, { useState } from 'react'
import { useSoarData } from './hooks/useSoarData.js'
import MapForecast, { certLabel } from './components/MapForecast.jsx'
import PointForecast from './components/PointForecast.jsx'
import Settings      from './components/Settings.jsx'
import Info          from './components/Info.jsx'
import WelcomeModal  from './components/WelcomeModal.jsx'

// icons8 ios-filled icon helper
function I8({ name, size = 16, color = 'aaaaaa', style: s = {} }) {
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
  { label: 'Map Forecast',   icon: 'map'      },
  { label: 'Point Forecast', icon: 'marker'   },
  { label: 'Settings',       icon: 'settings' },
  { label: 'Info',           icon: 'info'     },
]

const styles = {
  app: {
    minHeight: '100vh',
    background: '#0f1117',
    color: '#e0e0e0',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    padding: '16px 20px 0',
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: '#7eb8f7',
    marginBottom: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  tabBar: {
    display: 'flex',
    gap: 4,
    marginBottom: 0,
    position: 'sticky',
    top: 0,
    zIndex: 100,
    background: '#0f1117',
    paddingTop: 4,
    borderBottom: '1px solid #2a2a3e',
  },
  tab: (active) => ({
    padding: '8px 18px',
    border: 'none',
    borderRadius: '8px 8px 0 0',
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
    fontSize: 14,
    background: active ? '#1e1e2e' : 'transparent',
    color: active ? '#7eb8f7' : '#888',
    borderBottom: active ? '2px solid #7eb8f7' : '2px solid transparent',
    transition: 'all 0.15s',
  }),
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 20px',
    background: '#1e1e2e',
    borderBottom: '1px solid #2a2a3e',
    flexWrap: 'wrap',
  },
  select: {
    background: '#2a2a3e',
    color: '#e0e0e0',
    border: '1px solid #3a3a5e',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 14,
    cursor: 'pointer',
  },
  label: { fontSize: 13, color: '#aaa', marginRight: 4 },
  badge: (color) => ({
    padding: '3px 8px',
    borderRadius: 4,
    fontSize: 12,
    background: color,
    color: '#fff',
    fontWeight: 600,
  }),
  content: { padding: '16px 20px' },
  spinner: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '50vh',
    gap: 12,
    color: '#7eb8f7',
  },
}

const MODEL_NAMES = {
  soar_knmi:  'KNMI HARMONIE',
  soar_ecmwf: 'ECMWF IFS',
  soar_icon:  'DWD ICON D2',
  soar_arome: 'Météo-France AROME HD',
}

export default function App() {
  const [activeTab, setActiveTab] = useState(0)
  const data = useSoarData()
  const {
    status, days, loading, error,
    dateIdx, setDateIdx,
    certainty, model,
  } = data

  if (loading) return (
    <div style={styles.app}>
      <div style={styles.spinner}>
        <img src="/icon.png" width={50} height={50} style={{ display: 'inline-block', verticalAlign: 'middle' }} alt="" />
        <div>Loading Soaralarm NL…</div>
      </div>
    </div>
  )

  if (error) return (
    <div style={styles.app}>
      <div style={styles.spinner}>
        <I8 name="error" size={40} color="e05c5c" />
        <div>Could not reach API: {error}</div>
        <div style={{ fontSize: 13, color: '#aaa' }}>Make sure the FastAPI backend is running on port 8000</div>
      </div>
    </div>
  )

  const forecastReady = status?.forecast_available && status?.measurements_available && !!data.displayForecast

  return (
    <div style={styles.app}>
      {/* ── Welcome modal (first visit only) ── */}
      <WelcomeModal />

      {/* ── Header (title only, scrolls away) ── */}
      <header style={styles.header}>
        <div style={styles.title}>
          Soaralarm NL
          {status?.updating_forecast    && <span style={styles.badge('#e6a817')}>Updating forecast…</span>}
          {status?.updating_measurements && <span style={styles.badge('#3a7bd5')}>Updating measurements…</span>}
          {!forecastReady && !status?.updating_forecast &&
            <span style={styles.badge('#e05c5c')}>No forecast data</span>}
        </div>
      </header>

      {/* ── Tab bar (sticky) ── */}
      <nav style={styles.tabBar}>
        {TABS.map((t, i) => (
          <button key={t.label} style={styles.tab(activeTab === i)} onClick={() => setActiveTab(i)}>
            <I8
              name={t.icon}
              size={14}
              color={activeTab === i ? '7eb8f7' : '888888'}
              style={{ marginRight: 5 }}
            />
            {t.label}
          </button>
        ))}
      </nav>

      {/* ── Date bar ── */}
      {activeTab < 2 && (
        <div style={styles.controls}>
          <span style={styles.label}>Date:</span>
          <select
            style={styles.select}
            value={dateIdx}
            onChange={e => setDateIdx(Number(e.target.value))}
          >
            {days.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
          {/* Model name */}
          <span style={{ fontSize: 12, color: '#666' }}>
            {MODEL_NAMES[model] ?? model}
          </span>
          {/* Confidence badge for selected day */}
          {(() => {
            const c = certainty?.[dateIdx]
            if (!c) return null
            const dayBar = data.displayForecast?.[dateIdx]
            const hasFly = dayBar?.some(pf =>
              (pf.good_hours + pf.cross_hours + pf.gusty_hours + pf.cross_gusty_hours) > 0
            )
            if (!hasFly) return null
            const { label, color } = certLabel(c.agree, c.total)
            // Use best_pi from certainty to check weather flags for the highlighted point
            const bestPf = dayBar?.[c.best_pi ?? 0]
            return (
              <>
                <span style={{
                  fontSize: 11, fontWeight: 700, color,
                  background: color + '22',
                  padding: '2px 8px', borderRadius: 4,
                }}>
                  {label}
                </span>
                {bestPf?.has_rain && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#3a7bd5', background: '#3a7bd522', padding: '2px 8px', borderRadius: 4 }}>
                    Rain
                  </span>
                )}
                {bestPf?.has_fog && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#9090b8', background: '#9090b822', padding: '2px 8px', borderRadius: 4 }}>
                    Fog
                  </span>
                )}
              </>
            )
          })()}
          {status?.forecast_age_seconds != null && (
            <span style={{ fontSize: 12, color: '#666' }}>
              Forecast updated {Math.round(status.forecast_age_seconds / 60)} min ago
            </span>
          )}
        </div>
      )}

      {/* ── Tab content ── */}
      <main style={styles.content}>
        {activeTab === 0 && (
          forecastReady
            ? <MapForecast data={data} />
            : <LoadingPanel msg="Fetching forecast data, please wait…" />
        )}
        {activeTab === 1 && (
          forecastReady
            ? <PointForecast data={data} />
            : <LoadingPanel msg="Fetching forecast data, please wait…" />
        )}
        {activeTab === 2 && <Settings data={data} />}
        {activeTab === 3 && <Info data={data} />}
      </main>
    </div>
  )
}

function LoadingPanel({ msg }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: '#888' }}>
      <img src="/icon.png" width={50} height={50} style={{ display: 'inline-block', verticalAlign: 'middle' }} alt="" />
      <div>{msg}</div>
    </div>
  )
}