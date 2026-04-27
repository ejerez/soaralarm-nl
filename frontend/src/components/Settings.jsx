import React, { useState, useRef, useEffect, useCallback } from 'react'
import { fs } from '../fs.js'

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
  font:      "'Atkinson Hyperlegible', system-ui, sans-serif",
}

const card    = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: '20px 24px', maxWidth: 480, marginBottom: 16 }
const field   = { marginBottom: 22 }
const label_  = { display: 'block', marginBottom: 6, fontSize: fs(12), color: T.text2, fontWeight: 500, letterSpacing: '0.02em', textTransform: 'uppercase' }
const select_ = { background: T.raised, color: T.text, border: `1px solid ${T.borderEm}`, borderRadius: 6, padding: '7px 10px', fontSize: fs(13), cursor: 'pointer', fontFamily: T.font }
const input_  = { background: T.raised, color: T.text, border: `1px solid ${T.borderEm}`, borderRadius: 6, padding: '6px 10px', fontSize: fs(13), width: 85, textAlign: 'right', fontFamily: T.font }

function Tooltip({ children, width = 280 }) {
  return (
    <div style={{
      position: 'absolute', top: 'calc(100% + 6px)', left: '50%',
      transform: 'translateX(-50%)', width,
      background: T.card, border: `1px solid ${T.border}`,
      borderRadius: 6, padding: '8px 12px',
      fontSize: fs(12), color: T.text2, lineHeight: 1.55, zIndex: 100,
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
          onChange={e => { setTipOpen(false); const k = e.target.value; onChange({ key: k, size: wings[k]?.default_size ?? entry.size, model: undefined }) }}
          disabled={wingKeys.length === 0}
        >
          {wingKeys.map(k => <option key={k} value={k}>{wings[k].display_name}</option>)}
        </select>

        {tooltip ? (
          <span ref={tipRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button onClick={() => setTipOpen(o => !o)} aria-label="Wing info" style={{
              background: tipOpen ? T.raised : 'transparent', color: tipOpen ? '#8888cc' : T.text3,
              border: `1px solid ${T.border}`, borderRadius: '50%', width: 20, height: 20,
              fontSize: fs(11), lineHeight: 1, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
            }}>ⓘ</button>
          </span>
        ) : null}

        {isRemovable
          ? <button onClick={onRemove} title="Remove" style={{ background:'transparent', border:`1px solid ${T.border}`, borderRadius:4, width:26, height:26, cursor:'pointer', color:T.text2, fontSize:fs(13), display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>✕</button>
          : null
        }
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, paddingLeft: 2 }}>
        <span style={{ fontSize: fs(12), color: T.text3 }}>Model</span>
        <input type="text" style={{ ...input_, width: 120 }}
          value={entry.model ?? ''}
          onChange={e => onChange({...entry, model: e.target.value || undefined})}
          placeholder={wings[entry.key]?.display_name ?? ''}
          title="Optional wing model name shown in tooltips"
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, paddingLeft: 2 }}>
        <span style={{ fontSize: fs(12), color: T.text3 }}>Size</span>
        <input type="text" inputMode="numeric" pattern="\d*" style={{ ...input_, width: 48 }}
          value={entry.size}
          onChange={e => { const v = e.target.value; if (v===''||/^\d+$/.test(v)) onChange({...entry,size:v===''?'':Number(v)}) }}
          placeholder="m²" title="Wing size in m²"
        />
        <span style={{ fontSize: fs(12), color: T.text2 }}>m²</span>
      </div>
      {tipOpen && tooltip && (
        <div style={{ marginTop: 6, padding: '8px 12px', background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: fs(12), color: T.text2, lineHeight: 1.55 }}>
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
        fontSize: fs(11), lineHeight: 1, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
      }}>ⓘ</button>
      {open && <Tooltip width={290}>Disables wing and weight-based flyable wind range calculations, and uses your custom minimum and maximum wind instead. Note that this applies the same wind range to all locations.</Tooltip>}
    </span>
  )
}

export default function Settings({ data }) {
  const { timeStart, setTimeStart, timeEnd, setTimeEnd,
          customTimeWindow, setCustomTimeWindow, effectiveTimeStart, effectiveTimeEnd,
          defaultTimeStart, defaultTimeEnd,
          selectedWings, setSelectedWings, weight, setWeight,
          customWind, setCustomWind, windMin, setWindMin, windMax, setWindMax,
          speedUnit, setSpeedUnit,
          altFont, setAltFont, largeFont, setLargeFont, outdoorsMode, setOutdoorsMode,
          autoModelSelection, setAutoModelSelection,
          wings, countries, modes, country, mode, status, refreshForecast, refetchDisplay, switchConfig } = data

  const wingKeys = Object.keys(wings)
  const firstKey = wingKeys[0]
  const rows = (selectedWings.length === 0 && firstKey)
    ? [{ key: firstKey, size: wings[firstKey].default_size }]
    : selectedWings

  const isStandalone = typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true)
  const isIOS = typeof window !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
  const [installable, setInstallable] = useState(!!window.__deferredInstallPrompt)
  const canInstall = !isStandalone && (installable || isIOS)

  useEffect(() => {
    const onInstallable = () => setInstallable(true)
    const onInstalled = () => setInstallable(false)
    window.addEventListener('soaralarm:installable', onInstallable)
    window.addEventListener('soaralarm:installed', onInstalled)
    return () => {
      window.removeEventListener('soaralarm:installable', onInstallable)
      window.removeEventListener('soaralarm:installed', onInstalled)
    }
  }, [])

  const handleInstall = async () => {
    if (isIOS) {
      alert('To add Soaralarm to your home screen, tap the "Share" button in Safari and select "Add to Home Screen".')
      return
    }
    const prompt = window.__deferredInstallPrompt
    if (!prompt) return
    prompt.prompt()
    await prompt.userChoice
    window.__deferredInstallPrompt = null
    setInstallable(false)
  }

  // Auto-save: debounced refetch after any change
  const refetchTimer = useRef(null)
  const autoApply = useCallback(() => {
    clearTimeout(refetchTimer.current)
    refetchTimer.current = setTimeout(() => refetchDisplay(), 300)
  }, [refetchDisplay])

  function updateRow(i, v) {
    const next = rows.map((r, j) => j === i ? v : r)
    setSelectedWings(next.map(r => { const o = { key: r.key, size: Number(r.size) || 0 }; if (r.model) o.model = r.model; return o }))
    autoApply()
  }
  function removeRow(i) {
    const next = rows.filter((_, j) => j !== i)
    setSelectedWings(next.map(r => { const o = { key: r.key, size: Number(r.size) || 0 }; if (r.model) o.model = r.model; return o }))
    autoApply()
  }
  function addRow() {
    if (rows.length >= MAX_WINGS || !firstKey) return
    const next = [...rows, { key: firstKey, size: wings[firstKey]?.default_size ?? 0 }]
    setSelectedWings(next.map(r => { const o = { key: r.key, size: Number(r.size) || 0 }; if (r.model) o.model = r.model; return o }))
    autoApply()
  }

  return (
    <div>
      <div style={{ marginBottom: 20, fontSize: fs(16), fontWeight: 600, color: T.text }}>Settings</div>

        {/* Tutorial button */}
        <button
          onClick={() => window.dispatchEvent(new Event('soaralarm:start-tutorial'))}
          style={{
            background: T.card, color: T.text2,
            border: `1px solid ${T.border}`, borderRadius: 8,
            padding: '9px 22px', fontSize: fs(13), cursor: 'pointer',
            fontFamily: T.font, display: 'inline-flex', alignItems: 'center', gap: 8,
            marginRight: 12, marginBottom: 16,
          }}
        >
          <img src="/paraglider_small.png" width={26} height={26} alt="" /> App Tutorial
        </button>

        {/* Add to Home Screen button */}
        {!isStandalone && (
          <button
            data-tutorial="settings-install"
            onClick={handleInstall}
            disabled={!canInstall}
            style={{
              background: T.card, color: canInstall ? T.text2 : T.text3,
              border: `1px solid ${T.border}`, borderRadius: 8,
              padding: '9px 22px', fontSize: fs(13), cursor: canInstall ? 'pointer' : 'not-allowed',
              fontFamily: T.font, display: 'inline-flex', alignItems: 'center', gap: 8,
              marginBottom: 16,
              opacity: canInstall ? 1 : 0.5,
            }}
          >
            <img src="/paraglider_small.png" width={26} height={26} alt="" /> Add to Home Screen
          </button>
        )}

      {/* Card 1: Country, Mode, Speed Unit, Forecast Model */}
      <div style={card}>
        <div data-tutorial="settings-country-mode" style={{ display: 'flex', gap: 12, marginBottom: 22 }}>
          <div style={{ flex: 1 }}>
            <label style={label_}>Country</label>
            <select style={{ ...select_, width: '100%' }}
              value={country || ''}
              onChange={e => switchConfig(e.target.value, mode)}
            >
              {countries && Object.entries(countries).map(([code, c]) => (
                <option key={code} value={code}>{c.name || c}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={label_}>Mode</label>
            <select style={{ ...select_, width: '100%' }}
              value={mode || ''}
              onChange={e => switchConfig(country, e.target.value)}
            >
              {modes && Object.entries(modes).map(([code, name]) => (
                <option key={code} value={code}>{typeof name === 'string' ? name : name.name || code}</option>
              ))}
            </select>
          </div>
        </div>

        <div data-tutorial="settings-speed-unit">
        <div style={field}>
          <label style={label_}>Speed Units</label>
          <select style={{ ...select_, width: '100%' }} value={speedUnit} onChange={e => setSpeedUnit(e.target.value)}>
            <option value="km/h">km/h</option>
            <option value="kt">kt</option>
            <option value="m/s">m/s</option>
          </select>
        </div>

        <div style={{ marginBottom: 0 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={autoModelSelection} onChange={e => setAutoModelSelection(e.target.checked)}
              style={{ width: 15, height: 15, cursor: 'pointer', accentColor: T.accent }} />
            <span style={{ fontSize: fs(13), color: T.text, fontWeight: 500 }}>Automatic Model Selection</span>
          </label>
          <div style={{ fontSize: fs(11), color: T.text3, marginTop: 4, paddingLeft: 23 }}>Uses the best model for each day.</div>
        </div>
        </div>

      </div>

      {/* Card 2: Wings, Weight, Custom Wind */}
      <div style={card}>
        <div data-tutorial="settings-wings">
          <div style={field}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={customWind} onChange={e => { setCustomWind(e.target.checked); autoApply() }}
                  style={{ width: 15, height: 15, cursor: 'pointer', accentColor: T.accent }} />
                <span style={{ fontSize: fs(13), color: T.text, fontWeight: 500 }}>Custom Wind Range</span>
              </label>
              <CustomWindTooltip />
            </div>
            {customWind && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingLeft: 23 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: fs(12), color: T.text2 }}>Min. wind</span>
                  <input type="text" inputMode="numeric" pattern="\d*" style={{ ...input_, width: 60 }}
                    value={windMin}
                    onChange={e => { if (/^\d*$/.test(e.target.value)) { setWindMin(e.target.value); autoApply() } }}
                    onBlur={e => { const n = parseInt(e.target.value); setWindMin(isNaN(n) ? 15 : n); autoApply() }}
                    placeholder="15" />
                  <span style={{ fontSize: fs(12), color: T.text2 }}>km/h</span>
                </div>
                <span style={{ color: T.text3 }}>→</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: fs(12), color: T.text2 }}>Max. gusts</span>
                  <input type="text" inputMode="numeric" pattern="\d*" style={{ ...input_, width: 60 }}
                    value={windMax}
                    onChange={e => { if (/^\d*$/.test(e.target.value)) { setWindMax(e.target.value); autoApply() } }}
                    onBlur={e => { const n = parseInt(e.target.value); setWindMax(isNaN(n) ? 60 : n); autoApply() }}
                    placeholder="60" />
                  <span style={{ fontSize: fs(12), color: T.text2 }}>km/h</span>
                </div>
              </div>
            )}
          </div>

          <div style={{ opacity: customWind ? 0.4 : 1, pointerEvents: customWind ? 'none' : 'auto', transition: 'opacity 0.2s' }}>
            <div style={field}>
              <label style={label_}>Wings</label>
            {rows.map((entry, i) => (
              <WingRow key={i} entry={entry} wings={wings} isRemovable={i > 0}
                onChange={v => updateRow(i, v)} onRemove={() => removeRow(i)} />
            ))}
            {rows.length < MAX_WINGS && wingKeys.length > 0 && (
              <button onClick={addRow} style={{ ...select_, background: 'transparent', padding: '5px 12px', marginTop: 4, fontSize: fs(12), color: T.text2, cursor: 'pointer' }}>
                + Add wing
              </button>
            )}
            <div style={{ fontSize: fs(11), color: T.text3, marginTop: 6 }}>Up to {MAX_WINGS} wings.</div>
          </div>

          <div data-tutorial="settings-weight" style={{ marginBottom: 0 }}>
            <label style={label_}>Total Weight in Flight</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="text" inputMode="decimal" style={{ ...input_, width: 80 }}
                value={weight}
                onChange={e => { const v=e.target.value; if(v===''||/^\d*\.?\d*$/.test(v)) { setWeight(v); autoApply() } }}
                onBlur={e => { const n=parseFloat(e.target.value); setWeight((!isNaN(n)&&n>0)?n:75); autoApply() }}
                placeholder="75" />
              <span style={{ fontSize: fs(12), color: T.text2 }}>kg</span>
            </div>
            <div style={{ fontSize: fs(11), color: T.text3, marginTop: 5 }}>Used to adjust flyable wind ranges.</div>
          </div>
        </div>
      </div>
      </div>

      {/* Card 3: Preferences */}
      <div style={card}>
        <div data-tutorial="settings-preferences">
          <label style={{ ...label_, marginBottom: 14 }}>Preferences</label>

          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={outdoorsMode} onChange={e => setOutdoorsMode(e.target.checked)}
                  style={{ width: 15, height: 15, cursor: 'pointer', accentColor: T.accent }} />
                <span style={{ fontSize: fs(13), color: T.text, fontWeight: 500 }}>Sunny Mode</span>
              </label>
            </div>
            <div style={{ fontSize: fs(11), color: T.text3, marginTop: 4, paddingLeft: 23 }}>High contrast mode for sunny days.</div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={largeFont} onChange={e => setLargeFont(e.target.checked)}
                  style={{ width: 15, height: 15, cursor: 'pointer', accentColor: T.accent }} />
                <span style={{ fontSize: fs(13), color: T.text, fontWeight: 500 }}>Large Font</span>
              </label>
            </div>
            <div style={{ fontSize: fs(11), color: T.text3, marginTop: 4, paddingLeft: 23 }}>Increases font size for easier reading.</div>
          </div>
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={altFont} onChange={e => setAltFont(e.target.checked)}
                  style={{ width: 15, height: 15, cursor: 'pointer', accentColor: T.accent }} />
                <span style={{ fontSize: fs(13), color: T.text, fontWeight: 500 }}>Alternative Font</span>
              </label>
            </div>
            <div style={{ fontSize: fs(11), color: T.text3, marginTop: 4, paddingLeft: 23 }}>Switches to DM Sans.</div>
          </div>
        </div>

        <div data-tutorial="settings-window">
          <h3 style={{ fontSize: fs(12), color: T.text2, fontWeight: 500, letterSpacing: '0.02em', textTransform: 'uppercase', marginBottom: 8 }}>Availability Window</h3>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={customTimeWindow} onChange={e => { setCustomTimeWindow(e.target.checked); autoApply() }}
                style={{ width: 15, height: 15, cursor: 'pointer', accentColor: T.accent }} />
              <span style={{ fontSize: fs(13), color: T.text, fontWeight: 500 }}>Custom Time Window</span>
            </label>
            <div style={{ fontSize: fs(11), color: T.text3, marginTop: 4, paddingLeft: 23 }}>
              {customTimeWindow ? 'Using your custom window.' : `Auto: ${defaultTimeStart} → ${defaultTimeEnd} (sunrise/sunset ± 1hr)`}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: customTimeWindow ? 1 : 0.4 }}>
            <input type="time" step="3600" style={input_} value={customTimeWindow ? timeStart : effectiveTimeStart}
              disabled={!customTimeWindow}
              onChange={e => { setTimeStart(e.target.value.slice(0, 3) + '00'); autoApply() }} />
            <span style={{ color: T.text3 }}>→</span>
            <input type="time" step="3600" style={input_} value={customTimeWindow ? timeEnd : effectiveTimeEnd}
              disabled={!customTimeWindow}
              onChange={e => { setTimeEnd(e.target.value.slice(0, 3) + '00'); autoApply() }} />
          </div>
          <div style={{ fontSize: fs(11), color: T.text3, marginTop: 5 }}>Flyable hours are calculated within this window.</div>
        </div>
      </div>

      {/* Status panel */}
      <div style={card}>
        <div style={{ fontSize: fs(13), fontWeight: 600, color: T.text, marginBottom: 14 }}>Data Status</div>
        <StatusRow label="Forecast"     age={status?.forecast_age_seconds}    stale={status?.forecast_stale}    updating={status?.updating_forecast} />
        <StatusRow label="Measurements" age={status?.measurement_age_seconds} stale={status?.measurement_stale} updating={status?.updating_measurements} inDaylight={status?.measurement_in_daylight ?? true} />
        <RainTilesStatusRow 
          tilesInfo={status?.rain_tiles_info} 
          updating={status?.updating_measurements} 
        />
      </div>
    </div>
  )
}

function StatusRow({ label, age, stale, updating, inDaylight = true }) {
  const ageStr = age != null ? `${Math.round(age/60)} min ago` : '—'
  let dotColor, statusText
  if (updating) {
    dotColor = '#e6a817'; statusText = 'Updating'
  } else if (!inDaylight) {
    // Night mode: still show fresh/stale within night TTL
    if (stale) { dotColor = '#555555'; statusText = 'Night (stale)' }
    else       { dotColor = '#7a7acc'; statusText = 'Night (fresh)' }
  } else if (stale) {
    dotColor = '#ef5350'; statusText = 'Stale'
  } else {
    dotColor = '#1fd100'; statusText = 'Fresh'
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, fontSize: fs(13) }}>
      <span style={{ color: T.text }}>{label}</span>
      <span style={{ color: T.text2, fontSize: fs(12) }}>{ageStr}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 500, fontSize: fs(12), color: dotColor }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, display: 'inline-block' }} />
        {statusText}
      </span>
    </div>
  )
}

function RainTilesStatusRow({ tilesInfo, updating }) {
  // tilesInfo should be an array of tile ages in minutes, sorted oldest to newest
  const tileCount = tilesInfo?.length || 0
  
  // Determine color and status based on tile count
  let dotColor, statusText
  if (updating) {
    dotColor = '#e6a817'; statusText = 'Updating'
  } else if (tileCount === 4) {
    dotColor = '#1fd100'; statusText = '4 tiles'  // Green for 4 tiles
  } else if (tileCount === 3) {
    dotColor = '#e6a817'; statusText = '3 tiles'   // Yellow for 3 tiles
  } else if (tileCount === 2) {
    dotColor = '#ff9800'; statusText = '2 tiles' // Orange for 2 tiles
  } else if (tileCount === 1) {
    dotColor = '#ef5350'; statusText = '1 tile'  // Red for 1 tile
  } else {
    dotColor = '#666666'; statusText = 'No tiles'   // Gray for 0 tiles
  }
  
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, fontSize: fs(13) }}>
      <span style={{ color: T.text }}>Radar Tiles</span>
      <span style={{ color: T.text2, fontSize: fs(12), textAlign: 'right' }}>
        {tileCount > 0
          ? tilesInfo.map((age, i) => <span key={i} style={{ display: 'block' }}>{age}min ago</span>)
          : '—'}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 500, fontSize: fs(12), color: dotColor }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, display: 'inline-block' }} />
        {statusText}
      </span>
    </div>
  )
}
