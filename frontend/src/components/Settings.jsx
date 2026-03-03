import React, { useState } from 'react'

const MAX_WINGS = 5

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

const selectStyle = {
  background: '#2a2a3e',
  color: '#e0e0e0',
  border: '1px solid #3a3a5e',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 14,
  cursor: 'pointer',
}

const inputStyle = {
  background: '#2a2a3e',
  color: '#e0e0e0',
  border: '1px solid #3a3a5e',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 14,
  width: 64,
  textAlign: 'right',
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

const iconBtn = (color = '#3a3a5e') => ({
  background: color,
  color: '#e0e0e0',
  border: 'none',
  borderRadius: 6,
  width: 30,
  height: 30,
  fontSize: 16,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  lineHeight: 1,
})

function WingRow({ entry, wings, isRemovable, onChange, onRemove }) {
  const wingKeys = Object.keys(wings)

  function handleKeyChange(e) {
    const key = e.target.value
    onChange({ key, size: wings[key]?.default_size ?? entry.size })
  }

  function handleSizeChange(e) {
    const val = e.target.value
    if (val === '' || /^\d+$/.test(val)) {
      onChange({ ...entry, size: val === '' ? '' : Number(val) })
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <select
        style={{ ...selectStyle, flex: 1 }}
        value={entry.key}
        onChange={handleKeyChange}
        disabled={wingKeys.length === 0}
      >
        {wingKeys.map(k => (
          <option key={k} value={k}>{wings[k].display_name}</option>
        ))}
      </select>

      <input
        type="text"
        inputMode="numeric"
        pattern="\d*"
        style={inputStyle}
        value={entry.size}
        onChange={handleSizeChange}
        placeholder="m²"
        title="Wing size in m²"
      />
      <span style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>m²</span>

      {isRemovable ? (
        <button style={iconBtn('#3a2a2e')} onClick={onRemove} title="Remove wing">✕</button>
      ) : (
        // Spacer so all rows stay aligned
        <div style={{ width: 30, flexShrink: 0 }} />
      )}
    </div>
  )
}

export default function Settings({ data }) {
  const {
    model, setModel,
    timeStart, setTimeStart,
    timeEnd, setTimeEnd,
    selectedWings, setSelectedWings,
    weight, setWeight,
    wings,
    status, refreshForecast, refetchDisplay,
  } = data

  const [localModel, setLocalModel] = useState(model)
  const [localTs, setLocalTs]       = useState(timeStart)
  const [localTe, setLocalTe]       = useState(timeEnd)
  const [localWings, setLocalWings] = useState(selectedWings)
  const [localWeight, setLocalWeight] = useState(weight)
  const [saved, setSaved]           = useState(false)

  const wingKeys = Object.keys(wings)
  const firstKey = wingKeys[0]

  // Ensure there is always at least one row once wings catalogue is loaded
  const rows = (localWings.length === 0 && firstKey)
    ? [{ key: firstKey, size: wings[firstKey].default_size }]
    : localWings

  function updateRow(index, value) {
    setLocalWings(rows.map((r, i) => (i === index ? value : r)))
  }

  function removeRow(index) {
    setLocalWings(rows.filter((_, i) => i !== index))
  }

  function addRow() {
    if (rows.length >= MAX_WINGS || !firstKey) return
    setLocalWings([...rows, { key: firstKey, size: wings[firstKey]?.default_size ?? 0 }])
  }

  function handleSave() {
    const cleaned = rows.map(r => ({ key: r.key, size: Number(r.size) || 0 }))
    setModel(localModel)
    setTimeStart(localTs)
    setTimeEnd(localTe)
    setSelectedWings(cleaned)
    setWeight(localWeight)
    setSaved(true)
    refetchDisplay()
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div>
      <h2 style={{ marginBottom: 20, color: '#ccc', fontSize: 18 }}>Settings</h2>
      <div style={card}>

        {/* Forecast Model */}
        <div style={field}>
          <label style={label}>Forecast Model</label>
          <select
            style={{ ...selectStyle, width: '100%' }}
            value={localModel}
            onChange={e => setLocalModel(e.target.value)}
          >
            <option value="soar_knmi">KNMI Seamless</option>
            <option value="soar_ecmwf">ECMWF IFS (may pick onshore points)</option>
          </select>
        </div>

        {/* Wings */}
        <div style={field}>
          <label style={label}>Wings</label>

          {rows.map((entry, i) => (
            <WingRow
              key={i}
              entry={entry}
              wings={wings}
              isRemovable={i > 0}
              onChange={val => updateRow(i, val)}
              onRemove={() => removeRow(i)}
            />
          ))}

          {rows.length < MAX_WINGS && wingKeys.length > 0 && (
            <button
              style={{
                ...iconBtn(),
                width: 'auto',
                padding: '5px 12px',
                marginTop: 4,
                fontSize: 13,
                gap: 6,
              }}
              onClick={addRow}
            >
              + Add wing
            </button>
          )}
          <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
            Up to {MAX_WINGS} wings. Size defaults to the model's standard size.
          </div>
        </div>

        {/* Total Weight */}
        <div style={field}>
          <label style={label}>Total Weight (in flight)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="text"
              inputMode="decimal"
              style={{ ...inputStyle, width: 90 }}
              value={localWeight}
              onChange={e => {
                const val = e.target.value
                if (val === '' || /^\d*\.?\d*$/.test(val)) setLocalWeight(val)
              }}
              onBlur={e => {
                const n = parseFloat(e.target.value)
                if (!isNaN(n) && n > 0) setLocalWeight(n)
                else setLocalWeight(75)
              }}
              placeholder="75"
            />
            <span style={{ fontSize: 13, color: '#666' }}>kg</span>
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
            Used to scale wind ranges together with wing size.
          </div>
        </div>

        {/* Time window */}
        <div style={field}>
          <label style={label}>Flyable Hours Time Window</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="time" style={inputStyle}
              value={localTs} onChange={e => setLocalTs(e.target.value)}
            />
            <span style={{ color: '#666' }}>→</span>
            <input
              type="time" style={inputStyle}
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
        <Row label="Forecast"     age={status?.forecast_age_seconds}    stale={status?.forecast_stale}    updating={status?.updating_forecast} />
        <Row label="Measurements" age={status?.measurement_age_seconds} stale={status?.measurement_stale} updating={status?.updating_measurements} />
        <button
          style={{ ...saveBtn, background: '#2a2a3e', marginTop: 16 }}
          onClick={() => { refreshForecast(); refetchDisplay() }}
          disabled={status?.updating_forecast || (status?.forecast_age_seconds != null && status.forecast_age_seconds < 14400)}
          title={status?.forecast_age_seconds != null && status.forecast_age_seconds < 14400
            ? `Available in ${Math.ceil((14400 - status.forecast_age_seconds) / 60)} min`
            : 'Force refresh forecast'}
        >
          ↻ Force Refresh Forecast
        </button>
      </div>
    </div>
  )
}

function Row({ label, age, stale, updating }) {
  const ageStr      = age != null ? `${Math.round(age / 60)} min ago` : 'never'
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