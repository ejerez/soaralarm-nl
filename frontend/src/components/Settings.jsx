import React, { useState, useEffect } from 'react'

const card = {
  background: '#1e1e2e',
  border: '1px solid #2a2a3e',
  borderRadius: 8,
  padding: '20px 24px',
  maxWidth: 480,
}

const field = { marginBottom: 24 }

const label = {
  display: 'block',
  marginBottom: 6,
  fontSize: 13,
  color: '#aaa',
  fontWeight: 500,
}

const select = {
  background: '#2a2a3e',
  color: '#e0e0e0',
  border: '1px solid #3a3a5e',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 14,
  cursor: 'pointer',
}

const input = {
  background: '#2a2a3e',
  color: '#e0e0e0',
  border: '1px solid #3a3a5e',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 14,
  width: 110,
}

const saveBtn = {
  background: '#3a7bd5',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '9px 24px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  marginTop: 8,
}

const savedMsg = {
  marginLeft: 12,
  fontSize: 13,
  color: '#1fd100',
}

export default function Settings({ data }) {
  const {
    model, setModel,
    timeStart, setTimeStart,
    timeEnd, setTimeEnd,
    wing, setWing,
    wingSize, setWingSize,
    wings,
    status, refreshForecast, refetchDisplay,
  } = data

  const [localModel, setLocalModel]   = useState(model)
  const [localTs, setLocalTs]         = useState(timeStart)
  const [localTe, setLocalTe]         = useState(timeEnd)
  const [localWing, setLocalWing]     = useState(wing)
  const [localWingSize, setLocalWingSize] = useState(wingSize ?? '')
  const [saved, setSaved]             = useState(false)

  // When the wing dropdown changes, reset size to that wing's default
  function handleWingChange(e) {
    const key = e.target.value
    setLocalWing(key)
    if (wings[key]) {
      setLocalWingSize(wings[key].default_size)
    }
  }

  // Only allow integers in the size field
  function handleSizeChange(e) {
    const val = e.target.value
    if (val === '' || /^\d+$/.test(val)) {
      setLocalWingSize(val === '' ? '' : Number(val))
    }
  }

  function handleSave() {
    setModel(localModel)
    setTimeStart(localTs)
    setTimeEnd(localTe)
    setWing(localWing)
    setWingSize(localWingSize !== '' ? Number(localWingSize) : null)
    setSaved(true)
    refetchDisplay()
    setTimeout(() => setSaved(false), 2500)
  }

  const wingKeys = Object.keys(wings)

  return (
    <div>
      <h2 style={{ marginBottom: 20, color: '#ccc', fontSize: 18 }}>Settings</h2>
      <div style={card}>

        {/* Forecast Model */}
        <div style={field}>
          <label style={label}>Forecast Model</label>
          <select style={{ ...select, width: '100%' }} value={localModel} onChange={e => setLocalModel(e.target.value)}>
            <option value="soar_knmi">KNMI Seamless</option>
            <option value="soar_ecmwf">ECMWF IFS (may pick onshore points)</option>
          </select>
        </div>

        {/* Wing Model + Size */}
        <div style={field}>
          <label style={label}>Wing</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <select
              style={{ ...select, flex: 1 }}
              value={localWing}
              onChange={handleWingChange}
              disabled={wingKeys.length === 0}
            >
              {wingKeys.length === 0 && (
                <option value="">Loading…</option>
              )}
              {wingKeys.map(key => (
                <option key={key} value={key}>
                  {wings[key].display_name}
                </option>
              ))}
            </select>
            <input
              type="text"
              inputMode="numeric"
              pattern="\d*"
              style={{ ...input, width: 72 }}
              value={localWingSize}
              onChange={handleSizeChange}
              placeholder="m²"
              title="Wing size in m²"
            />
            <span style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>m²</span>
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
            Wing size defaults to the selected model's standard size.
          </div>
        </div>

        {/* Time window */}
        <div style={field}>
          <label style={label}>Flyable Hours Time Window</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="time" style={input}
              value={localTs} onChange={e => setLocalTs(e.target.value)}
            />
            <span style={{ color: '#666' }}>→</span>
            <input
              type="time" style={input}
              value={localTe} onChange={e => setLocalTe(e.target.value)}
            />
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
            Only hours within this window count toward the "flyable hours" chart.
          </div>
        </div>

        <button style={saveBtn} onClick={handleSave}>Save &amp; Apply</button>
        {saved && <span style={savedMsg}>✓ Saved</span>}
      </div>

      {/* Status panel */}
      <div style={{ ...card, marginTop: 24 }}>
        <h3 style={{ color: '#ccc', marginBottom: 12, fontSize: 15 }}>Data Status</h3>
        <Row label="Forecast"     age={status?.forecast_age_seconds}     stale={status?.forecast_stale}     updating={status?.updating_forecast} />
        <Row label="Measurements" age={status?.measurement_age_seconds}  stale={status?.measurement_stale}  updating={status?.updating_measurements} />
        <button
          style={{ ...saveBtn, background: '#2a2a3e', marginTop: 16 }}
          onClick={() => { refreshForecast(); refetchDisplay() }}
          disabled={status?.updating_forecast}
        >
          ↻ Force Refresh Forecast
        </button>
      </div>
    </div>
  )
}

function Row({ label, age, stale, updating }) {
  const ageStr = age != null ? `${Math.round(age / 60)} min ago` : 'never'
  const statusColor = updating ? '#e6a817' : stale ? '#e05c5c' : '#1fd100'
  const statusText  = updating ? 'Updating…' : stale ? 'Stale' : 'Fresh'
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 13 }}>
      <span style={{ color: '#aaa' }}>{label}</span>
      <span style={{ color: '#666' }}>{ageStr}</span>
      <span style={{ color: statusColor, fontWeight: 600 }}>{statusText}</span>
    </div>
  )
}