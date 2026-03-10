import React, { useState, useEffect } from 'react'

const STORAGE_KEY = 'soaralarm_welcomed'

function I8({ name, size = 18, color = 'aaaaaa', style: s = {} }) {
  return (
    <img
      src={`https://img.icons8.com/ios-filled/${size * 2}/${color}/${name}.png`}
      width={size} height={size}
      style={{ display: 'inline-block', verticalAlign: 'middle', ...s }}
      alt=""
    />
  )
}

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
          <img src="/paraglider.png" width={'clamp(60px, 14vw, 120px)'} style={{ display: 'inline-block', verticalAlign: 'middle' }} alt="" />
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#7eb8f7' }}>
            Welcome to Soaralarm NL!
          </h2>
        </div>

        {/* Intro */}
        <h3 style={h3}>About</h3>
        Soaralarm.nl is a forecasting tool for soaring at the Dutch coast. It includes many more features than other existing tools,
        and places everything together for convenience. At first glance, it might seem a somewhat overwhelming amount of information,
        but everything you need to know when you can fly is there!

        {/* How to use */}
        <h3 style={h3}>What is where</h3>

        <div style={section}>
          <I8 name="map" size={18} color="7eb8f7" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <b style={{ color: '#ccc' }}>Map Forecast</b>
            <p style={{ ...p, margin: '2px 0 0' }}>
              The map shows an overview of the conditions at each location for the selected day. Below it, you can see
              a chart showing the estimated flyable hours at the best location each day, and further down a Gantt chart 
              shows the estimated flyable windows. Both charts include a <b style={{ color: '#ccc' }}>confidence score</b> 
              showing how many of the four weather models agree on the forecast.
            </p>
          </div>
        </div>

        <div style={section}>
          <I8 name="map" size={18} color="7eb8f7" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <b style={{ color: '#ccc' }}>Best Location?</b>
            <p style={{ ...p, margin: '2px 0 0' }}>
              The best location is chosen as the one most models agree has flyable weather (ignoring rain and fog), with the selected model's
              flyable hours used to break ties. The more models agree, the higher the confidence score, 
              from <b style={{ color: '#ef5350' }}>Low</b> for just one model to <b style={{ color: '#00e676' }}>Very High</b> for all four. 
            </p>
          </div>
        </div>

        <div style={section}>
          <I8 name="marker" size={18} color="7eb8f7" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <b style={{ color: '#ccc' }}>Point Forecast</b>
            <p style={{ ...p, margin: '2px 0 0' }}>
              Here you will find detailed hourly forecasts and live measurements for the selected location and day.
              When you enter this tab, you are automatically taken to the best calculated location, based on confidence scores.
              The data you can see here includes wind speed &amp; gusts, precipitation, wind heading, temperature, and visibility.
            </p>
          </div>
        </div>

        <div style={section}>
          <I8 name="settings" size={18} color="7eb8f7" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <b style={{ color: '#ccc' }}>Settings</b>
            <p style={{ ...p, margin: '2px 0 0' }}>
              In this tab you can select your wing type and size (for up to 5 wings), total weight in flight, preferred forecast
              model, and daily availability window. Tap <b style={{ color: '#ccc' }}>Save &amp; Apply </b>
              to update all charts. Advanced pilots can enable the <b style={{ color: '#ccc' }}>Custom Wind Range</b> to
              bypass wing and weight calculations and set their own minimum and maximum wind speed directly.
            </p>
          </div>
        </div>

        <div style={section}>
          <I8 name="info" size={18} color="7eb8f7" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <b style={{ color: '#ccc' }}>Info</b>
            <p style={{ ...p, margin: '2px 0 0' }}>
              Here you will find information about Soaralarm and how each thing, the forecasts, the wind ranges, the flyability, etc.
              is obtained and/or calculated.
            </p>
          </div>
        </div>

        {/* Disclaimer nudge */}
        <p style={{ ...p, marginTop: 12, padding: '10px 14px', background: '#252535', borderRadius: 6, borderLeft: '3px solid #e6a817' }}>
          The flyable hours and windows shown are exclusively an <b style={{ color: '#ccc' }}>optimistic estimate </b>
          meant to provide a convenient way to quickly know which sites may be flyable in the upcoming days, and are in
          no way a guarantee that you will be able to (safely) fly. Always use your own judgement – check conditions suit 
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
              <img src="/paraglider_small.png" width={40} height={40} style={{ display: 'inline-block', verticalAlign: 'middle' }} alt="" /> Continue 
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