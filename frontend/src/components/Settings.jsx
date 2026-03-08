import React, { useState, useRef, useEffect } from 'react'

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
  const [tipOpen, setTipOpen] = useState(false)
  const tipRef = useRef(null)
  const tooltip = wings[entry.key]?.tooltip

  function handleKeyChange(e) {
    const key = e.target.value
    setTipOpen(false)
    onChange({ key, size: wings[key]?.default_size ?? entry.size })
  }

  function handleSizeChange(e) {
    const val = e.target.value
    if (val === '' || /^\d+$/.test(val)) {
      onChange({ ...entry, size: val === '' ? '' : Number(val) })
    }
  }

  // Close tooltip when tapping/clicking outside
  useEffect(() => {
    if (!tipOpen) return
    function handleOutside(e) {
      if (tipRef.current && !tipRef.current.contains(e.target)) setTipOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [tipOpen])

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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

        {/* Info icon — only shown when the selected wing has a tooltip */}
        {tooltip ? (
          <button
            style={{
              background: tipOpen ? '#3a5a8a' : '#2a2a3e',
              color: tipOpen ? '#7eb8f7' : '#668',
              border: '1px solid #3a3a5e',
              borderRadius: '50%',
              width: 22, height: 22,
              fontSize: 12, lineHeight: 1,
              cursor: 'pointer', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0,
            }}
            onClick={() => setTipOpen(o => !o)}
            aria-label="Wing info"
          >ⓘ</button>
        ) : (
          <div style={{ width: 22, flexShrink: 0 }} />
        )}

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
          <div style={{ width: 30, flexShrink: 0 }} />
        )}
      </div>

      {/* Tooltip bubble — expands below the row */}
      {tipOpen && tooltip && (
        <div ref={tipRef} style={{
          marginTop: 6,
          padding: '8px 12px',
          background: '#252535',
          border: '1px solid #3a3a5e',
          borderRadius: 6,
          fontSize: 12,
          color: '#aaa',
          lineHeight: 1.5,
        }}>
          {tooltip}
        </div>
      )}
    </div>
  )
}


function CustomWindTooltip() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [open])

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: open ? '#3a5a8a' : '#2a2a3e',
          color: open ? '#7eb8f7' : '#668',
          border: '1px solid #3a3a5e',
          borderRadius: '50%',
          width: 22, height: 22,
          fontSize: 12, lineHeight: 1,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, flexShrink: 0,
        }}
        aria-label="Custom wind info"
      >ⓘ</button>
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 290,
          background: '#252535',
          border: '1px solid #3a3a5e',
          borderRadius: 6,
          padding: '8px 12px',
          fontSize: 12,
          color: '#aaa',
          lineHeight: 1.5,
          zIndex: 100,
        }}>
          Disables wing and weight-based flyable wind range calculations, and uses your custom minimum and maximum wind instead. Note that this applies the same wind range to all locations.
        </div>
      )}
    </span>
  )
}


export default function Settings({ data }) {
  const {
    model, setModel,
    timeStart, setTimeStart,
    timeEnd, setTimeEnd,
    selectedWings, setSelectedWings,
    weight, setWeight,
    customWind, setCustomWind,
    windMin, setWindMin,
    windMax, setWindMax,
    wings,
    status, refreshForecast, refetchDisplay,
  } = data

  const [localModel, setLocalModel]       = useState(model)
  const [localTs, setLocalTs]             = useState(timeStart)
  const [localTe, setLocalTe]             = useState(timeEnd)
  const [localWings, setLocalWings]       = useState(selectedWings)
  const [localWeight, setLocalWeight]     = useState(weight)
  const [localCustomWind, setLocalCustomWind] = useState(customWind)
  const [localWindMin, setLocalWindMin]   = useState(windMin)
  const [localWindMax, setLocalWindMax]   = useState(windMax)
  const [saved, setSaved]                 = useState(false)

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
    setCustomWind(localCustomWind)
    setWindMin(Number(localWindMin) || 15)
    setWindMax(Number(localWindMax) || 60)
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
            <option value="soar_knmi">KNMI HARMONIE</option>
            <option value="soar_ecmwf">ECMWF IFS (may pick onshore points)</option>
            <option value="soar_icon">DWD ICON D2</option>
            <option value="soar_arome">Météo-France AROME HD</option>
          </select>
        </div>

        {/* Custom Wind Range */}
        <div style={field}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={localCustomWind}
                onChange={e => setLocalCustomWind(e.target.checked)}
                style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#3a7bd5' }}
              />
              <span style={{ fontSize: 13, color: '#aaa', fontWeight: 500 }}>Custom Wind Range</span>
            </label>
            <CustomWindTooltip />
          </div>
          {localCustomWind && (
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13, color: '#888' }}>Min. wind</span>
                <input
                  type="text" inputMode="numeric" pattern="\d*"
                  style={{ ...inputStyle, width: 64 }}
                  value={localWindMin}
                  onChange={e => { if (/^\d*$/.test(e.target.value)) setLocalWindMin(e.target.value) }}
                  onBlur={e => { const n = parseInt(e.target.value); setLocalWindMin(isNaN(n) ? 15 : n) }}
                  placeholder="15"
                />
                <span style={{ fontSize: 13, color: '#666' }}>km/h</span>
              </div>
              <span style={{ color: '#555' }}>→</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13, color: '#888' }}>Max. gusts</span>
                <input
                  type="text" inputMode="numeric" pattern="\d*"
                  style={{ ...inputStyle, width: 64 }}
                  value={localWindMax}
                  onChange={e => { if (/^\d*$/.test(e.target.value)) setLocalWindMax(e.target.value) }}
                  onBlur={e => { const n = parseInt(e.target.value); setLocalWindMax(isNaN(n) ? 60 : n) }}
                  placeholder="60"
                />
                <span style={{ fontSize: 13, color: '#666' }}>km/h</span>
              </div>
            </div>
          )}
        </div>

        {/* Wings + Weight — greyed out when custom wind is active */}
        <div style={{ opacity: localCustomWind ? 0.4 : 1, pointerEvents: localCustomWind ? 'none' : 'auto', transition: 'opacity 0.2s' }}>

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
            Up to {MAX_WINGS} wings.
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
            Used to adjust flyable wind ranges.
          </div>
        </div>

        </div>{/* end grey-out wrapper */}

        {/* Time window */}
        <div style={field}>
          <label style={label}>Availability to Fly</label>
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
            The "Flyable Hours" calculation will only use hours within your availability.
          </div>
        </div>

        <button style={saveBtn} onClick={handleSave}>Save &amp; Apply</button>
        {saved && <span style={savedMsg}><img src="https://img.icons8.com/ios-filled/24/1fd100/checkmark.png" width={12} height={12} style={{ verticalAlign: 'middle', marginRight: 4 }} alt="" />Saved</span>}
      </div>

      {/* Status panel */}
      <div style={{ ...card, marginTop: 24 }}>
        <h3 style={{ color: '#ccc', marginBottom: 12, fontSize: 15 }}>Data Status</h3>
        <Row label="Forecast"     age={status?.forecast_age_seconds}    stale={status?.forecast_stale}    updating={status?.updating_forecast} />
        <Row label="Measurements" age={status?.measurement_age_seconds} stale={status?.measurement_stale} updating={status?.updating_measurements} inDaylight={status?.measurement_in_daylight ?? true} />
        <button
          style={{ ...saveBtn, background: '#2a2a3e', marginTop: 16 }}
          onClick={() => { refreshForecast(); refetchDisplay() }}
          disabled={status?.updating_forecast || (status?.forecast_age_seconds != null && status.forecast_age_seconds < 7200)}
          title={status?.forecast_age_seconds != null && status.forecast_age_seconds < 7200
            ? `Available in ${Math.ceil((7200 - status.forecast_age_seconds) / 60)} min`
            : 'Force refresh forecast'}
        >
          ↻ Force Refresh Forecast
        </button>
      </div>
    </div>
  )
}

function Row({ label, age, stale, updating, inDaylight = true }) {
  const ageStr = age != null ? `${Math.round(age / 60)} min ago` : 'never'
  let statusColor, statusText
  if (updating) {
    statusColor = '#e6a817'; statusText = 'Updating…'
  } else if (stale && !inDaylight) {
    statusColor = '#555';    statusText = 'Night'
  } else if (stale) {
    statusColor = '#e05c5c'; statusText = 'Stale'
  } else {
    statusColor = '#1fd100'; statusText = 'Fresh'
  }
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 13 }}>
      <span style={{ color: '#aaa' }}>{label}</span>
      <span style={{ color: '#666' }}>{ageStr}</span>
      <span style={{ color: statusColor, fontWeight: 600 }}>{statusText}</span>
    </div>
  )
}