import React, { useState, useRef, useEffect } from 'react'

const MAX_WINGS = 5

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
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
  font:      "'DM Sans', system-ui, sans-serif",
}

const card    = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: '20px 24px', maxWidth: 480 }
const field   = { marginBottom: 22 }
const label_  = { display: 'block', marginBottom: 6, fontSize: 12, color: T.text2, fontWeight: 500, letterSpacing: '0.02em', textTransform: 'uppercase' }
const select_ = { background: T.raised, color: T.text, border: `1px solid ${T.borderEm}`, borderRadius: 6, padding: '7px 10px', fontSize: 13, cursor: 'pointer', fontFamily: T.font }
const input_  = { background: T.raised, color: T.text, border: `1px solid ${T.borderEm}`, borderRadius: 6, padding: '6px 10px', fontSize: 13, width: 64, textAlign: 'right', fontFamily: T.font }
const saveBtn = { background: T.accent, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 22px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }
const savedMsg = { marginLeft: 10, fontSize: 12, color: '#1fd100' }

function InfoCircle({ text, open, onToggle, ref: r }) {
  return (
    <span ref={r} style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={onToggle} aria-label="Info" style={{
        background: open ? T.raised : 'transparent',
        color: open ? '#8888cc' : T.text3,
        border: `1px solid ${T.border}`,
        borderRadius: '50%', width: 20, height: 20,
        fontSize: 11, lineHeight: 1, cursor: 'pointer', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
      }}>ⓘ</button>
    </span>
  )
}

function Tooltip({ children, width = 280 }) {
  return (
    <div style={{
      position: 'absolute', top: 'calc(100% + 6px)', left: '50%',
      transform: 'translateX(-50%)', width,
      background: T.card, border: `1px solid ${T.border}`,
      borderRadius: 6, padding: '8px 12px',
      fontSize: 12, color: T.text2, lineHeight: 1.55, zIndex: 100,
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    }}>
      {children}
    </div>
  )
}

function useClickOutside(ref, open, onClose) {
  useEffect(() => {
    if (!open) return
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', h)
    document.addEventListener('touchstart', h)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('touchstart', h) }
  }, [open, ref, onClose])
}

function WingRow({ entry, wings, isRemovable, onChange, onRemove }) {
  const wingKeys = Object.keys(wings)
  const [tipOpen, setTipOpen] = useState(false)
  const tipRef = useRef(null)
  const tooltip = wings[entry.key]?.tooltip
  const close = () => setTipOpen(false)
  useClickOutside(tipRef, tipOpen, close)

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <select style={{ ...select_, flex: 1, minWidth: 0 }} value={entry.key}
          onChange={e => { setTipOpen(false); const k = e.target.value; onChange({ key: k, size: wings[k]?.default_size ?? entry.size }) }}
          disabled={wingKeys.length === 0}
        >
          {wingKeys.map(k => <option key={k} value={k}>{wings[k].display_name}</option>)}
        </select>

        {tooltip ? (
          <span ref={tipRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button onClick={() => setTipOpen(o => !o)} aria-label="Wing info" style={{
              background: tipOpen ? T.raised : 'transparent', color: tipOpen ? '#8888cc' : T.text3,
              border: `1px solid ${T.border}`, borderRadius: '50%', width: 20, height: 20,
              fontSize: 11, lineHeight: 1, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
            }}>ⓘ</button>
            {tipOpen && <Tooltip>{tooltip}</Tooltip>}
          </span>
        ) : <div style={{ width: 20, flexShrink: 0 }} />}

        <input type="text" inputMode="numeric" pattern="\d*" style={{ ...input_, width: 48, flexShrink: 0 }}
          value={entry.size}
          onChange={e => { const v = e.target.value; if (v===''||/^\d+$/.test(v)) onChange({...entry,size:v===''?'':Number(v)}) }}
          placeholder="m²" title="Wing size in m²"
        />
        <span style={{ fontSize: 12, color: T.text2, whiteSpace: 'nowrap', flexShrink: 0 }}>m²</span>

        {isRemovable
          ? <button onClick={onRemove} title="Remove" style={{ background:'transparent', border:`1px solid ${T.border}`, borderRadius:4, width:26, height:26, cursor:'pointer', color:T.text2, fontSize:13, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>✕</button>
          : <div style={{ width: 26, flexShrink: 0 }} />
        }
      </div>
      {tipOpen && tooltip && (
        <div style={{ marginTop: 6, padding: '8px 12px', background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 12, color: T.text2, lineHeight: 1.55 }}>
          {tooltip}
        </div>
      )}
    </div>
  )
}

function CustomWindTooltip() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useClickOutside(ref, open, () => setOpen(false))
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setOpen(o=>!o)} aria-label="Custom wind info" style={{
        background: open ? T.raised : 'transparent', color: open ? '#8888cc' : T.text3,
        border: `1px solid ${T.border}`, borderRadius: '50%', width: 20, height: 20,
        fontSize: 11, lineHeight: 1, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
      }}>ⓘ</button>
      {open && <Tooltip width={290}>Disables wing and weight-based flyable wind range calculations, and uses your custom minimum and maximum wind instead. Note that this applies the same wind range to all locations.</Tooltip>}
    </span>
  )
}

export default function Settings({ data }) {
  const { model, setModel, timeStart, setTimeStart, timeEnd, setTimeEnd,
          selectedWings, setSelectedWings, weight, setWeight,
          customWind, setCustomWind, windMin, setWindMin, windMax, setWindMax,
          wings, status, refreshForecast, refetchDisplay } = data

  const [localModel,     setLocalModel]     = useState(model)
  const [localTs,        setLocalTs]        = useState(timeStart)
  const [localTe,        setLocalTe]        = useState(timeEnd)
  const [localWings,     setLocalWings]     = useState(selectedWings)
  const [localWeight,    setLocalWeight]    = useState(weight)
  const [localCustomWind,setLocalCustomWind]= useState(customWind)
  const [localWindMin,   setLocalWindMin]   = useState(windMin)
  const [localWindMax,   setLocalWindMax]   = useState(windMax)
  const [saved,          setSaved]          = useState(false)

  const wingKeys = Object.keys(wings)
  const firstKey = wingKeys[0]
  const rows = (localWings.length === 0 && firstKey)
    ? [{ key: firstKey, size: wings[firstKey].default_size }]
    : localWings

  function updateRow(i, v) { setLocalWings(rows.map((r, j) => j === i ? v : r)) }
  function removeRow(i)    { setLocalWings(rows.filter((_, j) => j !== i)) }
  function addRow()        { if (rows.length >= MAX_WINGS || !firstKey) return; setLocalWings([...rows, { key: firstKey, size: wings[firstKey]?.default_size ?? 0 }]) }

  function handleSave() {
    const cleaned = rows.map(r => ({ key: r.key, size: Number(r.size) || 0 }))
    setModel(localModel); setTimeStart(localTs); setTimeEnd(localTe)
    setSelectedWings(cleaned); setWeight(localWeight)
    setCustomWind(localCustomWind)
    setWindMin(Number(localWindMin) || 15); setWindMax(Number(localWindMax) || 60)
    setSaved(true); refetchDisplay()
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div>
      <div style={{ marginBottom: 20, fontSize: 16, fontWeight: 600, color: T.text }}>Settings</div>
      <div style={card}>
        <div style={field}>
          <label style={label_}>Forecast Model</label>
          <select style={{ ...select_, width: '100%' }} value={localModel} onChange={e => setLocalModel(e.target.value)}>
            <option value="soar_knmi">KNMI HARMONIE</option>
            <option value="soar_ecmwf">ECMWF IFS (may pick onshore points)</option>
            <option value="soar_icon">DWD ICON D2</option>
            <option value="soar_arome">Météo-France AROME HD</option>
          </select>
        </div>

        <div style={field}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={localCustomWind} onChange={e => setLocalCustomWind(e.target.checked)}
                style={{ width: 15, height: 15, cursor: 'pointer', accentColor: T.accent }} />
              <span style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>Custom Wind Range</span>
            </label>
            <CustomWindTooltip />
          </div>
          {localCustomWind && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingLeft: 23 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: T.text2 }}>Min. wind</span>
                <input type="text" inputMode="numeric" pattern="\d*" style={{ ...input_, width: 60 }}
                  value={localWindMin}
                  onChange={e => { if (/^\d*$/.test(e.target.value)) setLocalWindMin(e.target.value) }}
                  onBlur={e => { const n = parseInt(e.target.value); setLocalWindMin(isNaN(n) ? 15 : n) }}
                  placeholder="15" />
                <span style={{ fontSize: 12, color: T.text2 }}>km/h</span>
              </div>
              <span style={{ color: T.text3 }}>→</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: T.text2 }}>Max. gusts</span>
                <input type="text" inputMode="numeric" pattern="\d*" style={{ ...input_, width: 60 }}
                  value={localWindMax}
                  onChange={e => { if (/^\d*$/.test(e.target.value)) setLocalWindMax(e.target.value) }}
                  onBlur={e => { const n = parseInt(e.target.value); setLocalWindMax(isNaN(n) ? 60 : n) }}
                  placeholder="60" />
                <span style={{ fontSize: 12, color: T.text2 }}>km/h</span>
              </div>
            </div>
          )}
        </div>

        <div style={{ opacity: localCustomWind ? 0.4 : 1, pointerEvents: localCustomWind ? 'none' : 'auto', transition: 'opacity 0.2s' }}>
          <div style={field}>
            <label style={label_}>Wings</label>
            {rows.map((entry, i) => (
              <WingRow key={i} entry={entry} wings={wings} isRemovable={i > 0}
                onChange={v => updateRow(i, v)} onRemove={() => removeRow(i)} />
            ))}
            {rows.length < MAX_WINGS && wingKeys.length > 0 && (
              <button onClick={addRow} style={{ ...select_, background: 'transparent', padding: '5px 12px', marginTop: 4, fontSize: 12, color: T.text2, cursor: 'pointer' }}>
                + Add wing
              </button>
            )}
            <div style={{ fontSize: 11, color: T.text3, marginTop: 6 }}>Up to {MAX_WINGS} wings.</div>
          </div>

          <div style={field}>
            <label style={label_}>Total Weight in Flight</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="text" inputMode="decimal" style={{ ...input_, width: 80 }}
                value={localWeight}
                onChange={e => { const v=e.target.value; if(v===''||/^\d*\.?\d*$/.test(v)) setLocalWeight(v) }}
                onBlur={e => { const n=parseFloat(e.target.value); setLocalWeight((!isNaN(n)&&n>0)?n:75) }}
                placeholder="75" />
              <span style={{ fontSize: 12, color: T.text2 }}>kg</span>
            </div>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 5 }}>Used to adjust flyable wind ranges.</div>
          </div>
        </div>

        <div style={field}>
          <label style={label_}>Availability Window</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="time" style={input_} value={localTs} onChange={e => setLocalTs(e.target.value)} />
            <span style={{ color: T.text3 }}>→</span>
            <input type="time" style={input_} value={localTe} onChange={e => setLocalTe(e.target.value)} />
          </div>
          <div style={{ fontSize: 11, color: T.text3, marginTop: 5 }}>Flyable hours are only counted within this window.</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', marginTop: 4 }}>
          <button style={saveBtn} onClick={handleSave}>Save &amp; Apply</button>
          {saved && <span style={savedMsg}>✓ Applied</span>}
        </div>
      </div>

      {/* Status panel */}
      <div style={{ ...card, marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 14 }}>Data Status</div>
        <StatusRow label="Forecast"     age={status?.forecast_age_seconds}    stale={status?.forecast_stale}    updating={status?.updating_forecast} />
        <StatusRow label="Measurements" age={status?.measurement_age_seconds} stale={status?.measurement_stale} updating={status?.updating_measurements} inDaylight={status?.measurement_in_daylight ?? true} />
        <button
          onClick={() => { refreshForecast(); refetchDisplay() }}
          disabled={status?.updating_forecast || (status?.forecast_age_seconds != null && status.forecast_age_seconds < 7200)}
          title={status?.forecast_age_seconds != null && status.forecast_age_seconds < 7200 ? `Available in ${Math.ceil((7200-status.forecast_age_seconds)/60)} min` : 'Force refresh forecast'}
          style={{ ...saveBtn, background: 'transparent', border: `1px solid ${T.borderEm}`, color: T.text2, marginTop: 14, opacity: (status?.updating_forecast || (status?.forecast_age_seconds != null && status.forecast_age_seconds < 7200)) ? 0.4 : 1 }}
        >
          ↻ Force Refresh Forecast
        </button>
      </div>
    </div>
  )
}

function StatusRow({ label, age, stale, updating, inDaylight = true }) {
  const ageStr = age != null ? `${Math.round(age/60)} min ago` : '—'
  let dotColor, statusText
  if (updating)              { dotColor = '#e6a817'; statusText = 'Updating' }
  else if (stale && !inDaylight) { dotColor = '#555555'; statusText = 'Night' }
  else if (stale)            { dotColor = '#ef5350'; statusText = 'Stale' }
  else                       { dotColor = '#1fd100'; statusText = 'Fresh' }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, fontSize: 13 }}>
      <span style={{ color: T.text }}>{label}</span>
      <span style={{ color: T.text2, fontSize: 12 }}>{ageStr}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 500, fontSize: 12, color: dotColor }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, display: 'inline-block' }} />
        {statusText}
      </span>
    </div>
  )
}