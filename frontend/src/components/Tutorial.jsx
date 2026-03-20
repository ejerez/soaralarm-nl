import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'

const STORAGE_KEY = 'soaralarm_welcomed'
const SPOT_PAD    = 8
const TOOLTIP_W   = 380
const MARGIN      = 12
const T = {
  card:   '#262626',
  border: '#3d3d3d',
  text:   '#dedede',
  text2:  '#888888',
  text3:  '#555555',
  accent: '#5578e8',
  font:   "'DM Sans', system-ui, sans-serif",
}

const STEPS = [
  {
    tab: 0, selector: null, position: 'center',
    title: <><img src="/paraglider_small.png" width={22} height={22} style={{ verticalAlign: 'middle', marginRight: 8 }} alt="" />Welcome to Soaralarm</>,
    body:  <>Soaralarm is a <b style={{ color: T.text }}>free and open-source, feature-rich forecasting tool</b> built for pilots soaring in several European countries. This tutorial will show how to use it step by step.</>,
  },
  // ── Map tab intro ──
  {
    tab: 0, selector: null, position: 'center',
    title: 'Map tab',
    body:  <>The <b style={{ color: T.text }}>Map tab</b> gives you an overall view of the forecast, to quickly identify <b style={{ color: T.text }}>when and where</b> conditions look best.</>,
  },
  {
    tab: 0, selector: '[data-tutorial="map"]', position: 'below',
    title: 'The map',
    body:  <>Each dot marks a <b style={{ color: T.text }}>soaring location</b>. The <b style={{ color: T.text }}>wind slices</b> show estimated flyable hours for the selected day – a larger slice means more hours. Green indicates a <b style={{ color: '#1dbb02' }}>Good Heading</b> and yellow indicates <b style={{ color: '#ddb60a' }}>Crosswind</b>. Tap any marker to see a summary popup with a <b style={{ color: T.text }}>Spot information</b> link. Tapping a marker also selects that location, so you can switch to the <b style={{ color: T.text }}>Point tab</b> for the detailed forecast.</>,
  },
  {
    tab: 0, selector: '[data-tutorial="plotcontrols"]', position: 'below',
    title: 'Plot controls',
    body:  <><b style={{ color: T.text }}>Forecast days</b> limits how many days ahead the flyable hours and windows charts show. Enabling <b style={{ color: T.text }}>Show yesterday</b> adds the previous day to both charts.</>,
  },
  {
    tab: 0, selector: '[data-tutorial="barchart"]', position: 'above',
    title: 'Flyable hours',
    body:  <>Each stacked bar shows <b style={{ color: T.text }}>estimated flyable hours</b> at the calculated <b style={{ color: T.text }}>best location</b> for that day. <b style={{ color: '#1b8fe2' }}>Rain</b> and <b style={{ color: '#8888a0' }}>Fog</b> warnings appear above the bars when expected. <b style={{ color: T.text }}>Tapping on a bar</b> will <b style={{ color: T.text }}>automatically select</b> that day and location on the <b style={{ color: T.text }}>map</b> and on the <b style={{ color: T.text }}>Point tab</b>.</>,
  },
  {
    tab: 0, selector: '[data-tutorial="confidence"]', position: 'above',
    title: 'Confidence scores',
    body:  <>These scores reflect how many of the four weather models agree there will be flyable hours for that location and day. So <b style={{ color: '#d3357c' }}>★ means only one model predicts flyable conditions</b>, while <b style={{ color: '#00e6bc' }}>★★★★ means all 4 models do</b>. Not all models are available for all days, as some only produce forecasts for a limited number of days.</>,
  },
  {
    tab: 0, selector: '[data-tutorial="gantt"]', position: 'above',
    title: 'Flyable windows',
    body:  <>Shows when flyable conditions are expected during each day, at the <b style={{ color: T.text }}>best location</b>. Each coloured block is a <b style={{ color: T.text }}>flyable window</b> – tap it to see the wind category and exact time range. Note that, like with the bar chart, <b style={{ color: T.text }}>tapping on a time window</b> will <b style={{ color: T.text }}>automatically select</b> that day and location on both the <b style={{ color: T.text }}>map</b> and on the <b style={{ color: T.text }}>Point tab</b>.</>,
  },
  // ── Point tab intro ──
  {
    tab: 1, selector: null, position: 'center',
    title: 'Point tab',
    body:  <>The <b style={{ color: T.text }}>Point tab</b> shows detailed hourly forecasts and live measurements – as well as important information – for the selected spot.</>,
  },
  {
    tab: 1, selector: '[data-tutorial="pt-selectors"]', position: 'below',
    title: 'Location, links and site info',
    body:  <>Choose any <b style={{ color: T.text }}>soaring location</b> from the dropdown. The calculated <b style={{ color: T.text }}>best location</b> for the selected day is set by default. <b style={{ color: T.text }}>Google Maps</b> takes you to the coordinates, and <b style={{ color: T.text }}>Spot information</b> links to a detailed description of the site. At locations with multiple weather stations, <b style={{ color: T.text }}>radio buttons</b> let you choose which station's measurements to overlay.</>,
  },
  {
    tab: 1, selector: null, position: 'center',
    title: 'Site information symbols',
    body:  <>Each soaring location has <b style={{ color: T.text }}>information symbols</b> that convey important details at a glance – things like dune type, hazards, regulations, and other useful info. Let's take a look.</>,
  },
  {
    tab: 1, selector: '[data-tutorial="pt-symbols"]', position: 'below',
    title: 'Site information symbols',
    body:  <>These are the symbols for the currently selected spot. <b style={{ color: T.text }}>Tap any symbol</b> to read the information it contains.</>,
  },
  {
    tab: 1, selector: '[data-tutorial="pt-wind"]', position: 'below',
    title: 'Windspeed forecast',
    body:  <>Hourly <b style={{ color: T.text }}>wind and gust speed</b> for the selected location and day. The white band shows live measurements from the corresponding weather station. Green reference lines mark the <b style={{ color: T.text }}>flyable wind range</b> for each of your configured wings at this location.</>,
  },
  {
    tab: 1, selector: '[data-tutorial="pt-direction"]', position: 'below',
    title: 'Wind heading forecast',
    body:  <>Hourly <b style={{ color: T.text }}>wind heading</b> forecast. The colored bands show your flyable heading range: <b style={{ color: '#25b863' }}>Good heading</b> or <b style={{ color: '#d27a2d' }}>Crosswind</b>. The dashed line shows the live measurements.</>,
  },
  {
    tab: 1, selector: '[data-tutorial="pt-ranges"]', position: 'above',
    title: 'Windspeed ranges',
    body:  <>A summary of the <b style={{ color: T.text }}>calculated windspeed ranges</b> for each of <b style={{ color: T.text }}>your configured wings</b> at this location. These are derived from the site's dune geometry and your wing size and weight. If you have enabled <b style={{ color: T.text }}>Custom Wind Range</b> in <b style={{ color: T.text }}>Settings</b>, that overrides these calculations.</>,
  },
  // ── Settings tab intro ──
  {
    tab: 2, selector: null, position: 'center',
    title: 'Settings tab',
    body:  <>The <b style={{ color: T.text }}>Settings tab</b> lets you configure the app to your specific setup and preferences. All settings are saved locally in your browser.</>,
  },
  {
    tab: 2, selector: '[data-tutorial="settings-country-mode"]', position: 'below',
    title: 'Country and Mode',
    body:  <>Select the <b style={{ color: T.text }}>Country</b> to choose which set of soaring locations to display, and the <b style={{ color: T.text }}>Mode</b> to select aircraft type (e.g. paragliding or hang gliding). Each country has its own forecast models, locations, and measurement stations, and each mode has its own wing catalogue and wind range calibration.</>,
  },
  {
    tab: 2, selector: '[data-tutorial="settings-speed-unit"]', position: 'below',
    title: 'Speed units',
    body:  <>Choose your preferred <b style={{ color: T.text }}>wind speed unit</b>: km/h, knots, or m/s. This applies to all wind speed displays across the app, including the Point tab charts and wind range summaries.</>,
  },
  {
    tab: 2, selector: '[data-tutorial="settings-model"]', position: 'below',
    title: 'Forecast model',
    body:  <>Choose which weather model is used by the hourly <b style={{ color: T.text }}>Point tab</b> charts. The Map tab always combines all available models for confidence scoring. The <b style={{ color: T.text }}>default model</b> is generally the <b style={{ color: T.text }}>most accurate</b> for your selected country.</>,
  },
  {
    tab: 2, selector: '[data-tutorial="settings-wings"]', position: 'below',
    title: 'Wing configuration',
    body:  <>Add <b style={{ color: T.text }}>up to 5 wings</b>. For each, select the <b style={{ color: T.text }}>wing type</b> and enter the <b style={{ color: T.text }}>size in m²</b>. The app uses the site's dune geometry and your wing size and weight to calculate flyable wind speed ranges. You can enable <b style={{ color: T.text }}>Custom Wind Range</b> to bypass this and enter your own min/max windspeeds directly.</>,
  },
  {
    tab: 2, selector: '[data-tutorial="settings-weight"]', position: 'below',
    title: 'Total flight weight',
    body:  <>Your <b style={{ color: T.text }}>all-up weight</b> in kilograms – pilot, harness, payload and wing combined. This scales the calculated wind ranges: a <b style={{ color: T.text }}>heavier</b> pilot on the same wing flies <b style={{ color: T.text }}>faster</b>.</>,
  },
  {
    tab: 2, selector: '[data-tutorial="settings-window"]', position: 'below',
    title: 'Availability window',
    body:  <>Restricts the <b style={{ color: T.text }}>flyable hours</b> to those that fall within the times you are <b style={{ color: T.text }}>actually available to fly</b>. If you set 10:00 → 17:00, any flyable forecast hours outside that window are excluded from the flyable hours and flyable windows in the <b style={{ color: T.text }}>Map tab</b>.</>,
  },
  // ── Info tab intro ──
  {
    tab: 2, selector: null, position: 'center',
    title: "You're all set!",
    body:  <>That covers everything Soaralarm has to offer (for now!). You can <b style={{ color: T.text }}>redo this tutorial</b> at any time from the <b style={{ color: T.text }}>Settings tab</b>. Always bear in mind: flyable hour estimates are optimistic overestimations – <b style={{ color: T.text }}>always check that the conditions are suitable for your exact wing model and size, skill level and risk tolerance before attempting to fly</b>.</>,
  },
]

export default function Tutorial({ activeTab, onSwitchTab }) {
  const [open, setOpen]     = useState(false)
  const [step, setStep]     = useState(0)
  const [elRect, setElRect] = useState(null)
  const retryRef            = useRef(null)
  const rafRef              = useRef(null)
  const stepRef             = useRef(step)
  const openRef             = useRef(false)
  const advanceRef          = useRef(null)
  const retreatRef          = useRef(null)
  const closeRef            = useRef(null)
  const current             = STEPS[step]
  const tooltipRef          = useRef(null)
  const [tooltipH, setTooltipH] = useState(0)  // measured tooltip height for positioning

  // Measure tooltip height after every render so positioning uses real content size
  useLayoutEffect(() => {
    if (tooltipRef.current) setTooltipH(tooltipRef.current.offsetHeight)
  })

  // Once tooltipH is known for a step, scroll the page so there is enough
  // room on the preferred side of the spotlight for the tooltip.
  // The rAF tracking loop then updates elRect as the page scrolls, keeping
  // the spotlight and tooltip positions in sync automatically.
  const scrollCorrectedRef = useRef(false)
  useEffect(() => {
    if (tooltipH === 0 || !current.selector) return
    if (scrollCorrectedRef.current) return
    scrollCorrectedRef.current = true
    const el = document.querySelector(current.selector)
    if (!el) return
    const r   = el.getBoundingClientRect()
    const vh  = window.innerHeight
    const GAP = MARGIN * 2 + tooltipH
    // Scroll to ensure there are GAP pixels on the preferred side
    const wantAbove = current.position === 'above'
    const delta = wantAbove
      ? Math.min(0, r.top - GAP)               // scroll up if not enough room above
      : Math.max(0, r.bottom + GAP - vh)        // scroll down if not enough room below
    if (delta !== 0) window.scrollBy({ top: delta, behavior: 'smooth' })
  }, [tooltipH])  // eslint-disable-line

  useEffect(() => { stepRef.current = step }, [step])
  useEffect(() => { openRef.current = open }, [open])

  // Auto-start on first visit; listen for manual trigger
  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setOpen(true)
    const handler = () => { setStep(0); setOpen(true) }
    window.addEventListener('soaralarm:start-tutorial', handler)
    return () => window.removeEventListener('soaralarm:start-tutorial', handler)
  }, [])

  // Keyboard handler using stable refs
  useEffect(() => {
    const onKey = (e) => {
      if (!openRef.current) return
      if (e.key === 'ArrowRight' || e.key === 'Enter') advanceRef.current?.()
      else if (e.key === 'ArrowLeft') retreatRef.current?.()
      else if (e.key === 'Escape') closeRef.current?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // rAF tracker – continuously re-reads the element's viewport rect
  const startTracking = (selector) => {
    cancelAnimationFrame(rafRef.current)
    if (!selector) { setElRect(null); return }
    const tick = () => {
      if (!openRef.current) return
      const el = document.querySelector(selector)
      if (el) {
        const r = el.getBoundingClientRect()
        setElRect(prev => {
          if (prev &&
              Math.round(prev.top)    === Math.round(r.top)    &&
              Math.round(prev.left)   === Math.round(r.left)   &&
              Math.round(prev.width)  === Math.round(r.width)  &&
              Math.round(prev.height) === Math.round(r.height)) return prev
          return { top: r.top, left: r.left, width: r.width, height: r.height }
        })
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  // On step/tab change: switch tab if needed, scroll to center, start tracking
  useEffect(() => {
    if (!open) {
      cancelAnimationFrame(rafRef.current)
      clearInterval(retryRef.current)
      return
    }
    cancelAnimationFrame(rafRef.current)
    clearInterval(retryRef.current)
    setElRect(null)
    setTooltipH(0)  // hide until remeasured at new position
    scrollCorrectedRef.current = false

    if (current.tab !== activeTab) {
      onSwitchTab(current.tab)
      return
    }

    if (!current.selector) return

    let attempts = 0
    retryRef.current = setInterval(() => {
      attempts++
      const el = document.querySelector(current.selector)
      if (el || attempts >= 30) {
        clearInterval(retryRef.current)
        if (!el) return
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setTimeout(() => startTracking(current.selector), 380)
      }
    }, 80)

    return () => { clearInterval(retryRef.current); cancelAnimationFrame(rafRef.current) }
  }, [step, activeTab, open]) // eslint-disable-line

  const advance = () => stepRef.current < STEPS.length - 1 ? setStep(s => s + 1) : closeRef.current()
  const retreat = () => stepRef.current > 0 && setStep(s => s - 1)
  const close   = () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setOpen(false); setStep(0); setElRect(null)
    cancelAnimationFrame(rafRef.current)
    clearInterval(retryRef.current)
  }

  // Keep refs current every render
  advanceRef.current = advance
  retreatRef.current = retreat
  closeRef.current   = close

  if (!open) return null

  const vw = window.innerWidth
  const vh = window.innerHeight

  const spot = elRect && current.selector ? {
    top:    elRect.top    - SPOT_PAD,
    left:   elRect.left   - SPOT_PAD,
    width:  elRect.width  + SPOT_PAD * 2,
    height: elRect.height + SPOT_PAD * 2,
  } : null

  // Tooltip width scales with viewport
  const tw = Math.min(TOOLTIP_W, vw - 24)
  // Use measured height; fall back to 0 on first render (tooltip invisible until measured)
  const th = tooltipH
  let tooltipStyle
  let tooltipVisible = th > 0  // hide until we have a real measurement

  if (!spot || current.position === 'center') {
    tooltipStyle = { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: tw }
    tooltipVisible = true  // centred card always visible immediately
  } else {
    const cx         = Math.max(MARGIN, Math.min(spot.left + spot.width / 2 - tw / 2, vw - tw - MARGIN))
    const spaceAbove = spot.top - MARGIN * 2
    const spaceBelow = vh - (spot.top + spot.height) - MARGIN * 2
    // Prefer the hinted side if it fits; flip if it doesn't
    const wantAbove  = current.position === 'above'
    const fitsAbove  = spaceAbove >= th
    const fitsBelow  = spaceBelow >= th
    const goAbove    = wantAbove ? (fitsAbove || !fitsBelow) : (!fitsBelow && fitsAbove)

    if (goAbove) {
      // Anchor bottom of tooltip to just above spotlight; clamp so top stays on-screen
      const bottom = vh - spot.top + MARGIN
      const clampedBottom = Math.min(bottom, vh - th - MARGIN)
      tooltipStyle = { position: 'fixed', bottom: Math.max(clampedBottom, MARGIN), left: cx, width: tw }
    } else {
      // Anchor top of tooltip to just below spotlight; clamp so bottom stays on-screen
      const top = spot.top + spot.height + MARGIN
      const clampedTop = Math.min(top, vh - th - MARGIN)
      tooltipStyle = { position: 'fixed', top: Math.max(clampedTop, MARGIN), left: cx, width: tw }
    }
  }

  const btnBase = { border: 'none', borderRadius: 7, padding: 'clamp(6px,2vw,8px) clamp(14px,4vw,20px)', fontSize: 'clamp(12px,3.5vw,13px)', cursor: 'pointer', fontFamily: T.font }

  return (
    <>
      <div onClick={advance} style={{ position: 'fixed', inset: 0, zIndex: 9990, cursor: 'pointer' }} translate="no" />

      {spot ? (
        <div style={{
          position: 'fixed',
          top: spot.top, left: spot.left,
          width: spot.width, height: spot.height,
          borderRadius: 8,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.75)',
          border: `2px solid ${T.accent}88`,
          zIndex: 9991,
          pointerEvents: 'none',
        }} />
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9991, pointerEvents: 'none' }} />
      )}

      <div
        ref={tooltipRef}
        onClick={e => e.stopPropagation()}
        translate="no"
        style={{
          ...tooltipStyle,
          zIndex: 9992,
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: 'clamp(14px, 4vw, 20px) clamp(14px, 4vw, 22px) clamp(12px, 3vw, 16px)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.65)',
          fontFamily: T.font,
          visibility: tooltipVisible ? 'visible' : 'hidden',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: T.text3, letterSpacing: '0.04em' }}>
            STEP {step + 1} OF {STEPS.length}
          </span>
          <button onClick={close} style={{ background: 'none', border: 'none', color: T.text3, fontSize: 20, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ fontSize: 'clamp(13px, 4vw, 15px)', fontWeight: 700, color: T.text, marginBottom: 8, lineHeight: 1.3 }}>
          {current.title}
        </div>
        <div style={{ fontSize: 'clamp(12px, 3.5vw, 13px)', color: T.text2, lineHeight: 1.65 }}>
          {current.body}
        </div>

        <div style={{ display: 'flex', gap: 4, margin: '16px 0 14px', alignItems: 'center' }}>
          {STEPS.map((_, i) => (
            <div key={i} onClick={e => { e.stopPropagation(); setStep(i) }} title={STEPS[i].title}
              style={{
                flex: i === step ? 3 : 1, height: 4, borderRadius: 2, cursor: 'pointer',
                background: i === step ? T.accent : i < step ? T.accent + '50' : T.border,
                transition: 'all 0.2s ease',
              }}
            />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {step > 0 && (
            <button onClick={e => { e.stopPropagation(); retreat() }}
              style={{ ...btnBase, background: 'transparent', color: T.text2, border: `1px solid ${T.border}` }}>
              Back
            </button>
          )}
          <button onClick={e => { e.stopPropagation(); advance() }}
            style={{ ...btnBase, background: T.accent, color: '#fff', fontWeight: 600 }}>
            {step === STEPS.length - 1
              ? <><img src="/paraglider_small.png" width={20} height={20} style={{ verticalAlign: 'middle', marginRight: 6 }} alt="" />Done</>
              : 'Next'}
          </button>
        </div>

        {step === 0 && (
          <div style={{ textAlign: 'center', marginTop: 10, fontSize: 11, color: T.text3 }}>
            Click anywhere outside this card or press 'Next' to advance.
          </div>
        )}
      </div>
    </>
  )
}