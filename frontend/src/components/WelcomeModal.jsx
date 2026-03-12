import React, { useState, useEffect } from 'react'

const STORAGE_KEY = 'soaralarm_welcomed'

const T = {
  card:      '#262626',
  raised:    '#2e2e2e',
  border:    '#3d3d3d',
  borderDim: '#353535',
  text:      '#dedede',
  text2:     '#888888',
  accent:    '#5578e8',
  font:      "'DM Sans', system-ui, sans-serif",
}

function I8({ name, size = 16, color = '5e5e7a' }) {
  return <img src={`https://img.icons8.com/ios-filled/${size*2}/${color}/${name}.png`} width={size} height={size} style={{ display:'inline-block', verticalAlign:'middle' }} alt="" />
}

const h3_ = { fontSize: 12, fontWeight: 600, color: T.text2, margin: '18px 0 8px', letterSpacing: '0.04em', textTransform: 'uppercase' }
const p_  = { fontSize: 13, color: T.text2, lineHeight: 1.65, margin: '0 0 6px' }
const row_ = { display: 'flex', gap: 12, marginBottom: 12, alignItems: 'flex-start' }

export default function WelcomeModal() {
  const [open, setOpen] = useState(false)
  const [dontShow, setDontShow] = useState(false)

  useEffect(() => { if (!localStorage.getItem(STORAGE_KEY)) setOpen(true) }, [])

  function dismiss() {
    if (dontShow) localStorage.setItem(STORAGE_KEY, '1')
    setOpen(false)
  }

  if (!open) return null

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.75)',
      zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
      backdropFilter: 'blur(2px)',
    }}>
      <div style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        padding: '28px 28px 24px',
        maxWidth: 520,
        width: '100%',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 8px 48px rgba(0,0,0,0.7)',
        fontFamily: T.font,
      }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <img src="/paraglider.png" width={64} style={{ display:'block', flexShrink:0, opacity:0.9 }} alt="" />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: T.text, lineHeight: 1.2 }}>Welcome to Soaralarm NL</div>
            <div style={{ fontSize: 12, color: T.text2, marginTop: 4 }}>Soaring forecast for the Dutch coast</div>
          </div>
        </div>

        <p style={p_}>
          Soaralarm NL is a <b style={{ color: T.text }}>free and open-source</b> forecasting tool built for pilots soaring the dunes along the Dutch coast. It may seem like a lot at first glance — here's a quick overview.
        </p>

        <h3 style={h3_}>What is where</h3>

        {[
          { icon: 'map',      title: 'Map Forecast',   body: 'An overview of conditions at each location for the selected day — with a bar chart of estimated flyable hours and a Gantt chart of flyable windows. Both include a confidence score based on agreement across four weather models.' },
          { icon: 'marker',   title: 'Point Forecast', body: 'Hourly forecasts and live RWS measurements for a selected location. When you open this tab you\'re automatically taken to the best calculated location for the day.' },
          { icon: 'settings', title: 'Settings',       body: 'Select your wing type and size (up to 5 wings), total flight weight, preferred forecast model, and daily availability window. Advanced pilots can set a custom wind range directly.' },
          { icon: 'info',     title: 'Info',           body: 'Detailed explanation of how flyability is calculated, what the confidence scores mean, and how wind ranges are derived from your settings.' },
        ].map(it => (
          <div key={it.title} style={row_}>
            <span style={{ marginTop: 1, flexShrink: 0 }}><I8 name={it.icon} size={15} color="5578e8" /></span>
            <div>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{it.title}</span>
              <p style={{ ...p_, marginTop: 3 }}>{it.body}</p>
            </div>
          </div>
        ))}

        <div style={{ marginTop: 16, padding: '10px 14px', background: T.raised, borderRadius: 6, borderLeft: `3px solid ${T.border}`, fontSize: 12, color: T.text2, lineHeight: 1.6 }}>
          The flyable hours shown are an <b style={{ color: T.text }}>optimistic estimate</b> to help quickly identify potentially flyable days. They are not a guarantee. Always use your own judgement — check that conditions suit your wing, skill, and risk tolerance before flying.
        </div>

        <div style={{ marginTop: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 14, userSelect: 'none' }}>
            <input type="checkbox" checked={dontShow} onChange={e => setDontShow(e.target.checked)}
              style={{ width: 14, height: 14, cursor: 'pointer', accentColor: T.accent }} />
            <span style={{ fontSize: 12, color: T.text2 }}>Don't show this again</span>
          </label>
          <div style={{ textAlign: 'center' }}>
            <button onClick={dismiss} style={{
              background: T.accent, color: '#fff', border: 'none',
              borderRadius: 8, padding: '10px 36px',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 10,
              fontFamily: T.font,
            }}>
              <img src="/paraglider_small.png" width={26} height={26} alt="" />
              Let's go
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
