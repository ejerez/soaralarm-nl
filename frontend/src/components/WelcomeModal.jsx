import React, { useState, useEffect } from 'react'

const STORAGE_KEY = 'soaralarm_welcomed'

export default function WelcomeModal() {
  const [open, setOpen] = useState(false)
  const [dontShow, setDontShow] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setOpen(true)
  }, [])

  function dismiss() {
    if (dontShow) localStorage.setItem(STORAGE_KEY, '1')
    setOpen(false)
  }

  if (!open) return null

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.7)',
      zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px',
    }}>
      <div style={{
        background: '#1e1e2e',
        border: '1px solid #3a3a5e',
        borderRadius: 12,
        padding: '28px 28px 24px',
        maxWidth: 520,
        width: '100%',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
      }}>

        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 28 }}>🪂</span>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#7eb8f7' }}>
            Welcome to Soaralarm NL
          </h2>
        </div>

        {/* Intro */}
        <p style={p}>
          Soaralarm NL is a <b style={{ color: '#ccc' }}>free and open-source</b> project,
          built as a free service for the community of pilots who soar the dunes along the
          Dutch coast. It combines offshore wind forecasts using four major European weather models
          with live RWS measurements to give you an overview of the best spots to fly in the
          upcoming 7 days, plus detailed forecasts and measurements to judge the conditions 
          when you go fly.
        </p>

        {/* How to use */}
        <h3 style={h3}>What does it include?</h3>

        <div style={section}>
          <span style={icon}>🌍</span>
          <div>
            <b style={{ color: '#ccc' }}>Map Forecast</b>
            <p style={{ ...p, margin: '2px 0 0' }}>
              Overview of all locations for the selected date. A bar chart shows estimated flyable hours at
              the best location each day, and a Gantt chart shows the estimated flyable windows. The best
              location is chosen as the one most models agree has flyable weather, with the selected model's
              flyable hours used to break ties. Both charts include a colour-coded <b style={{ color: '#ccc' }}>confidence score</b>{' '}
              showing how many of the four weather models agree:
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 8px', margin: '6px 0 2px' }}>
              {[
                { label: 'Very High', color: '#00e676', note: '4/4 – days 0-2' },
                { label: 'High',      color: '#c6ef00', note: '3/4 or 3/3 – days 0-4' },
                { label: 'Medium',    color: '#ffa726', note: '2 models' },
                { label: 'Low',       color: '#ef5350', note: '1 model' },
              ].map(({ label, color, note }) => (
                <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#666' }}>
                  <span style={{ background: color + '22', color, fontWeight: 700, fontSize: 11, padding: '1px 6px', borderRadius: 4 }}>{label}</span>
                  {note}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div style={section}>
          <span style={icon}>📍</span>
          <div>
            <b style={{ color: '#ccc' }}>Point Forecast</b>
            <p style={{ ...p, margin: '2px 0 0' }}>
              Detailed hourly forecasts and live measurements for the selected location and day, conveniently
              defaults to the best location for the selected day – the one with the highest confidence score.
              This tab shows all the data you need to know in a single place: wind speed &amp; gusts, 
              precipitation, wind heading, temperature, and visibility.
            </p>
          </div>
        </div>

        <div style={section}>
          <span style={icon}>⚙</span>
          <div>
            <b style={{ color: '#ccc' }}>Settings</b>
            <p style={{ ...p, margin: '2px 0 0' }}>
              Select your wing type and size (up to 5 wings), total weight in flight, preferred forecast
              model, and daily availability window. Tap <b style={{ color: '#ccc' }}>Save &amp; Apply </b>
              to update all charts. Advanced pilots can enable <b style={{ color: '#ccc' }}>Custom Wind Range</b> to
              bypass wing and weight calculations and set their own minimum and maximum wind speed directly.
            </p>
          </div>
        </div>

        <div style={section}>
          <span style={icon}>ℹ️</span>
          <div>
            <b style={{ color: '#ccc' }}>Info</b>
            <p style={{ ...p, margin: '2px 0 0' }}>
              Explains how flyability is calculated, the wind range scaling formula, the
              data sources used, and shows the exact wind ranges and headings for every
              location given your current wings and weight selection.
            </p>
          </div>
        </div>

        {/* Disclaimer nudge */}
        <p style={{ ...p, marginTop: 12, padding: '10px 14px', background: '#252535', borderRadius: 6, borderLeft: '3px solid #e6a817' }}>
          The flyable hours and windows shown are exclusively an <b style={{ color: '#ccc' }}>optimistic estimate </b>
          meant to provide a convenient way to quickly know which sites may be flyable in the upcoming days, and are in
          no way a guarantee that you will be able to (safely) fly. Always use your own judgement - check conditions suit 
          your exact wing model, skill, fitness level and risk tolerance before attempting to fly.
        </p>

        {/* Dismiss */}
        <div style={{ marginTop: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 14, userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={dontShow}
              onChange={e => setDontShow(e.target.checked)}
              style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#3a7bd5' }}
            />
            <span style={{ fontSize: 13, color: '#666' }}>Don't show this pop-up again</span>
          </label>
          <div style={{ textAlign: 'center' }}>
            <button
              onClick={dismiss}
              style={{
                background: '#3a7bd5',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '11px 36px',
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Continue to Soaralarm NL 🪂
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

const p = { fontSize: 13, color: '#888', lineHeight: 1.65, margin: '0 0 8px' }
const h3 = { fontSize: 14, fontWeight: 600, color: '#aaa', margin: '16px 0 10px' }
const section = { display: 'flex', gap: 12, marginBottom: 12, alignItems: 'flex-start' }
const icon = { fontSize: 18, flexShrink: 0, marginTop: 1 }