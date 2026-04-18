import React, { useState, useEffect, useRef } from 'react'
import { fs } from '../fs.js'
import { _exec } from '../_cfg.js'

const DEFAULT_WEIGHT = 70.0

function effectiveRange(baseRange, defaultSize, selectedSize, weight) {
  const sizeRatio   = defaultSize / selectedSize
  const weightRatio = weight / DEFAULT_WEIGHT
  const factor      = Math.sqrt(sizeRatio * weightRatio)
  return [Math.round(baseRange[0] * factor), Math.round(baseRange[1] * factor)]
}

function wrapDeg(deg) {
  return ((deg % 360) + 360) % 360
}

const card = {
  background: '#262626',
  border: '1px solid #1e1e32',
  borderRadius: 8,
  padding: '20px 24px',
  marginBottom: 16,
}
const h2 = { fontSize: fs(15), fontWeight: 600, color: '#dedede', marginBottom: 12, marginTop: 0 }
const h3 = { fontSize: fs(11), fontWeight: 600, color: '#9a9a9a', marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: '0.04em' }
const p  = { fontSize: fs(13), color: '#9a9a9a', lineHeight: 1.7, margin: '0 0 8px' }

const code = {
  display: 'inline-block',
  background: '#2e2e2e',
  border: '1px solid #777777',
  borderRadius: 4,
  padding: '2px 8px',
  fontFamily: 'monospace',
  fontSize: fs(13),
  color: '#cccccc',
  margin: '4px 0',
}

// Dynamic per-country data sources components
const DATA_SOURCES_MODULES = import.meta.glob('./DataSources_*.jsx')

export default function Info({ data }) {
  const { points, wings, ranges, country, mode, countries, modes, selectedWings, weight, customWind, windMin, windMax, speedUnit = 'km/h' } = data
  const w = parseFloat(weight) || DEFAULT_WEIGHT
  const SPEED_FACTOR = { 'km/h': 1, 'kt': 1 / 1.852, 'm/s': 1 / 3.6 }
  const toUnit = (v) => v == null ? null : Math.round(v * SPEED_FACTOR[speedUnit])

  // Wings to show: fall back to all wing keys if nothing selected
  const wingKeys  = Object.keys(wings)
  const activeWings = selectedWings.length > 0 ? selectedWings : wingKeys.map(k => ({
    key: k, size: wings[k].default_size,
  }))

  // Dynamically load DataSources_<country>.jsx
  const [DataSources, setDataSources] = useState(null)
  useEffect(() => {
    if (!country) return
    const key = `./DataSources_${country}.jsx`
    const loader = DATA_SOURCES_MODULES[key]
    if (loader) {
      loader().then(m => setDataSources(() => m.default)).catch(() => setDataSources(null))
    } else {
      setDataSources(null)
    }
  }, [country])

  const [_diagOpen, setDiagOpen] = useState(false)
  const [_diagInput, setDiagInput] = useState('')
  const [_diagMsg, setDiagMsg] = useState('')
  const _tapTimes = useRef([])

  const _onImgTap = () => {
    const now = Date.now()
    _tapTimes.current = _tapTimes.current.filter(t => now - t < 5000)
    _tapTimes.current.push(now)
    if (_tapTimes.current.length >= 5) {
      _tapTimes.current = []
      setDiagOpen(true)
      setDiagInput('')
      setDiagMsg('')
    }
  }

  const _onDiagSubmit = () => {
    const result = _exec(_diagInput)
    setDiagMsg(result.msg)
    if (result.ok) {
      setTimeout(() => { setDiagOpen(false); window.location.reload() }, 800)
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={card}>
        <img
          src="/paraglider.png"
          style={{ display: 'block', width: 'clamp(250px, 14vw, 350px)', opacity: 0.9, marginBottom: 16, cursor: 'default' }}
          alt=""
          onClick={_onImgTap}
        />
        <h2 style={h2}>About Soaralarm</h2>
        <p style={{ ...p, margin: 0 }}>
          Soaralarm is a <b style={{ color: '#dedede' }}>free and open-source</b> project,
          built as a free service, originally for the community of pilots who soar the dunes along the
          Dutch coast. It combines offshore wind forecasts using multiple European weather models
          with live measurements from coastal stations to give you an overview of the best spots to fly in the
          upcoming 7 days, plus detailed hourly forecasts and measurements to judge the conditions
          when you go fly.
        </p>
      </div>

      {/* ── How flyability is calculated ── */}
      <div style={card}>
        <h2 style={h2}>Flyability calculation</h2>

        <p style={p}>
          Wind ranges and headings for each location are computed from the {' '}
          <b style={{ color: '#dedede' }}>slope steepness</b> and{' '}
          <b style={{ color: '#dedede' }}>height</b>. The base ranges are callibrated to 
          an experienced pilot of <b style={{ color: '#dedede' }}>70 kg</b> flying the
          following wings:
        </p>

        <ul style={{ ...p, paddingLeft: 20 }}>
          {wingKeys.map(k => (
            <li key={k}>
              <b style={{ color: '#dedede' }}>{wings[k].display_name}</b>
              {' – default size '}
              {wings[k].default_size} m²
            </li>
          ))}
        </ul>

        <h3 style={h3}>Low end of wind ranges</h3>
        <p style={p}>
          While different wings have different glide ratios, most wings have a similar c<sub>L max</sub>, and in any case the main limitations on the low end
          of the range are the takeoff options, dune geometry and pilot skill – not the efficiency of the wing.
        </p>
        <p style={p}>
          As such, the minimum flyable
          speed for each wing is determined by the dune steepness and height at each location, and the wing area and total in-flight weight.
          All wing types with the same area will have the same calculated minimum speed at a given location.
        </p>

        <h3 style={h3}>Wind speed ranges</h3>
        <p style={p}>
          The <b style={{ color: '#dedede' }}>minimum flyable speed</b> at each location is determined
          by the dune steepness category (flat, moderate, steep) and wind gradient compensation is applied
          as a function of dune height. See the speeds below for your current selection (<b style={{ color: '#dedede' }}>{modes?.[mode] || mode}</b>).
        </p>

        {ranges?.min_speed_by_steepness && (
          <>
            <p style={p}>Base <b style={{ color: '#dedede' }}>minimum wind speeds</b> by steepness (for a 10m dune):</p>
            <ul style={{ ...p, paddingLeft: 20 }}>
              {Object.entries(ranges.min_speed_by_steepness).map(([k, v]) => (
                <li key={k}><b style={{ color: '#dedede' }}>{k}</b>: {toUnit(v)} {speedUnit}</li>
              ))}
            </ul>
          </>
        )}

        {ranges?.max_speed_by_wing && (
          <>
            <p style={p}>Base <b style={{ color: '#dedede' }}>maximum gust speeds</b> per wing type (for a 10m dune):</p>
            <ul style={{ ...p, paddingLeft: 20 }}>
              {Object.entries(ranges.max_speed_by_wing).map(([k, v]) => (
                <li key={k}><b style={{ color: '#dedede' }}>{wings[k]?.display_name || k}</b>: {toUnit(v)} {speedUnit}</li>
              ))}
            </ul>
          </>
        )}

        <p style={p}>
          Taller dunes have a more pronounced wind gradient, thus
          the wind speed is greater at the top of the dune, and the spot is flyable at lower forecasted
          windspeeds. The speed ranges are corrected for dune heigh using the 
          following <b style={{ color: '#dedede' }}>wind gradient factor</b> function:
        </p>

        <div style={{ ...code, display: 'block', padding: '8px 14px', margin: '8px 0 12px' }}>
          factor = {ranges?.speed_height_scaling?.formula || '(A − B · height) / C'}
        </div>

        <h3 style={h3}>Wind range scaling for different sizes and weights</h3>
        <p style={p}>
          Wind ranges for different wing sizes and pilot weights are derived from the base ranges 
          by <b style={{ color: '#dedede' }}>solving for constant lift</b>:
        </p>
        <div style={{ ...code, display: 'block', padding: '8px 14px', margin: '8px 0 12px' }}>
          v₂ = v₁ · √((W₂/W₁) · (A₁/A₂))
        </div>
        <p style={p}>
          where <i>v</i> is airspeed, <i>W</i> is total pilot weight in flight, and <i>A</i> is wing area.
          This assumes the glide ratio and lift coefficient are the same across all sizes and weights for a
          given wing type, which is a simplification but close enough in most cases.
        </p>

        <h3 style={h3}>Heading ranges</h3>
        <p style={p}>
          The <b style={{ color: '#dedede' }}>flyable heading range</b> at each location is calculated as a function of
          dune height. For your current selection (<b style={{ color: '#dedede' }}>{modes?.[mode] || mode}</b>):
        </p>
        <div style={{ ...code, display: 'block', padding: '8px 14px', margin: '8px 0 12px' }}>
          half_range = {ranges?.heading_range?.formula || '60 · (height/15) / (sqrt((height/15)^2 + 1))'}
        </div>
        {ranges?.heading_range?.steepness_offset && (
          <>
            <p style={p}><b style={{ color: '#dedede' }}>Steepness offset</b> added to the half-range:</p>
            <ul style={{ ...p, paddingLeft: 20 }}>
              {Object.entries(ranges.heading_range.steepness_offset).map(([k, v]) => (
                <li key={k}><b style={{ color: '#dedede' }}>{k}</b>: {v > 0 ? '+' : ''}{v}°</li>
              ))}
            </ul>
          </>
        )}
        <p style={p}>
          This means taller, steeper slopes accept a wider range of
          wind directions. The <b style={{ color: '#dedede' }}>good heading</b> zone is always a fixed
          fraction ({ranges?.heading_range?.good_fraction != null
            ? `${Math.round(ranges.heading_range.good_fraction * 100)}%`
            : '50%'}) of the full crosswind range. At some spots, these calculated
          bounds are overriden due to other factors (e.g. turbulence from wind turbines).
        </p>

        <h3 style={h3}>Wind quality</h3>
        <p style={p}>
          Each hour is classified by wind direction relative to the site's ideal heading, with conditions
          considered "gusty" when the forecasted gusts exceed the forecasted windspeed by more than 20 km/h.
        </p>
        <ul style={{ ...p, paddingLeft: 20 }}>
          <li><b style={{ color: '#1fd100' }}>Good wind</b> – Comfortable wind heading.</li>
          <li><b style={{ color: '#d1bb16' }}>Crosswind</b> – Noticeably cross.</li>
          <li><b style={{ color: '#d68800' }}>Gusty</b> – Good wind heading, gusts &gt; 20 km/h over windspeed.</li>
          <li><b style={{ color: '#c12e0d' }}>Crosswind, Gusty</b> – Noticeably cross, gusts &gt; 20 km/h over windspeed.</li>
        </ul>
        <p style={p}>
          An hour counts as flyable only if the wind speed is within range for at least one of the selected
          wings, with precipitation ≤ 0.1 mm and visibility &gt; 300 m.
        </p>
        <p style={p}>
          Alternatively, the <b style={{ color: '#dedede' }}>Custom Wind Range</b> option in Settings disables
          wing and weight-based calculations and applies a single user-defined minimum wind speed and maximum
          gust speed uniformly to all locations.
        </p>
      </div>

      {/* ── Per-point table ── */}
      <div style={card}>
        <h2 style={h2}>Wind ranges and headings per location</h2>
        <p style={p}>The wind ranges are overestimates meant to indicate that you <b style={{ color: '#dedede' }}>may</b> be able to fly,
          not a guarantee that you will be able to.</p>
        <p style={{ ...p, marginBottom: 16 }}>
          These are the values for the current selected wings:{' '}
          {customWind
            ? <span>Custom wind range <b style={{ color: '#6be655' }}>{toUnit(windMin)}</b> – <b style={{ color: '#55e68f' }}>{toUnit(windMax)}</b> {speedUnit}</span>
            : <>
                {activeWings.map((aw, i) => (
                  <span key={aw.key}>
                    <b style={{ color: '#dedede' }}>{wings[aw.key]?.display_name ?? aw.key}</b>{' '}
                    {aw.size} m²{i < activeWings.length - 1 ? ', ' : ''}
                  </span>
                ))}
                {' '}at <b style={{ color: '#dedede' }}>{w} kg</b>
              </>
          }.
        </p>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: fs(12) }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #686868' }}>
                <th style={th}>Location</th>
                <th style={th}>Heading</th>
                <th style={th}>Good range</th>
                <th style={th}>Cross range</th>
                {customWind
                  ? <th style={th}>Wind ({speedUnit})<br /><span style={{ color: '#828282', fontWeight: 400 }}>custom range</span></th>
                  : activeWings.map(aw => (
                      <th key={aw.key} style={th}>
                        {wings[aw.key]?.display_name ?? aw.key}<br />
                        {aw.size} m² <span style={{ color: '#828282', fontWeight: 400 }}>[{speedUnit}]</span>
                      </th>
                    ))
                }
              </tr>
            </thead>
            <tbody>
              {points.map((pt, i) => (
                <tr key={pt.name} style={{ borderBottom: '1px solid #363636', background: i % 2 === 0 ? 'transparent' : '#363636' }}>
                  <td style={td}><b style={{ color: '#dedede' }}>{pt.name}</b></td>
                  <td style={{ ...td, color: '#a0ccfc' }}>{wrapDeg(pt.heading)}°</td>
                  <td style={td}>
                    {wrapDeg(Math.round(pt.heading + pt.head_range.good[0]))}° –{' '}
                    {wrapDeg(Math.round(pt.heading + pt.head_range.good[1]))}°
                  </td>
                  <td style={td}>
                    {wrapDeg(Math.round(pt.heading + pt.head_range.cross[0]))}° –{' '}
                    {wrapDeg(Math.round(pt.heading + pt.head_range.cross[1]))}°
                  </td>
                  {customWind
                    ? <td style={td}>
                        <span style={{ color: '#6be655' }}>{toUnit(windMin)}</span>
                        {' – '}
                        <span style={{ color: '#55e68f' }}>{toUnit(windMax)}</span>
                      </td>
                    : activeWings.map(aw => {
                        const base = pt.wind_range?.[aw.key]
                        if (!base) return <td key={aw.key} style={{ ...td, color: '#555' }}>–</td>
                        const [mn, mx] = effectiveRange(base, wings[aw.key].default_size, aw.size, w)
                        return (
                          <td key={aw.key} style={td}>
                            <span style={{ color: '#6be655' }}>{toUnit(mn)}</span>
                            {' – '}
                            <span style={{ color: '#55e68f' }}>{toUnit(mx)}</span>
                          </td>
                        )
                      })
                  }
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Data sources (per-country) ── */}
      {DataSources && (
        <div style={card}>
          <h2 style={h2}>Data sources</h2>
          <DataSources />
        </div>
      )}
      
      <div style={card}>
        <h2 style={h2}>A word from the developer</h2>
        <p style={p}>
          Hey there! If you're all the way down here, you must have really wanted to know how{' '} 
          <b style={{ color: '#dedede' }}>Soaralarm</b> works – hopefully this tab has provided the answers
          you were looking for.
        </p>
        <p style={p}> 
          My name is <b style={{ color: '#dedede' }}>Eduardo</b>, and I started working on <b style={{ color: '#dedede' }}>Soaralarm</b> in early
          2026, not long after starting to soar the Dutch dunes myself. I often found myself rather dissatisfied by
          the lack of easily available information about when and where to fly – not just in terms of the actual weather
          forecasts, but even basic facts like the exact location of the flying spots were often unclear to someone unfamiliar
          with the Dutch soaring scene. 
        </p>
        <p style={p}>
          <b style={{ color: '#dedede' }}>Soaralarm</b> was thus born, not just as a tool for convenience for experienced pilots, but
          as an attempt to democratize information about soaring the dunes, the idea being that a visiting pilot or newcomer
          could just check it and get all the information they need to make a good, safe decision at a glance. Not
          just a "go fly here", but a comprehensive set of information including flyability calculations, general information
          about the soaring spots, as well as warnings and links to primary sources to help pilots make informed decisions.
        </p>
        <p style={p}>
          This web app was made possible by the help of some of the awesome pilots who soar the dunes frequently, 
          including <b style={{ color: '#dedede' }}>Simon</b> from{' '}
          <a href="https://paraglidingisfun.com/" target="_blank" rel="noopener noreferrer" style={link}>
            Paragliding is Fun 
          </a>,{' '}
          who helped figure out what is flyable when and where – and helped me become a much better pilot –
          and <b style={{ color: '#dedede' }}>Bryan</b> from{' '}
          <a href="https://www.dune-rider.com/" target="_blank" rel="noopener noreferrer" style={link}>
            Dune Rider 
          </a>,{' '}
          whose fantastic wings introduced me to the life-changing sport of dune soaring.
        </p>
        <p style={p}>
          I am not a web developer, but an Aerospace Engineer. While I understand flight dynamics and 
          scientific programming well, developing such a complex web app
          wouldn't have been possible without{' '}
          <a href="https://www.anthropic.com/claude" target="_blank" rel="noopener noreferrer" style={link}>
            Claude
          </a>{' '}
          by Anthropic, and{' '}
          <a href="https://mistral.ai/" target="_blank" rel="noopener noreferrer" style={link}>
            Vibe
          </a>{' '}
          by Mistral, which helped in planning the backend architecture{' '}
          with <b style={{ color: '#dedede' }}>FastAPI</b>, developing the frontend with{' '}
          <b style={{ color: '#dedede' }}>React.js</b>, and adding features/refactoring/bugfixing at 
          a much faster rate than I could by hand.
        </p>
      </div>

      <div style={card}>
        <h2 style={h2}>Privacy</h2>
        <p style={p}>
          All your settings and preferences are only stored locally in your browser, and Soaralarm does 
          not collect or store any information of any kind about its users.
        </p>
      </div>

      <div style={card}>
        <h2 style={h2}>Contact</h2>
        <p style={p}>
          For questions or feedback, you can send an email to{' '}
          <a href="mailto:info@soaralarm.eu" target="_blank" rel="noopener noreferrer" style={link}>
            info@soaralarm.eu
          </a>
          {' '}or{' '}
          <a href="mailto:feedback@soaralarm.eu" target="_blank" rel="noopener noreferrer" style={link}>
            feedback@soaralarm.eu
          </a>,{' '}respectively.
        </p>

        <p style={p}>
          Want to request a new feature or spot/country be added? Send an email with the necessary information to{' '}
          <a href="mailto:requests@soaralarm.eu" target="_blank" rel="noopener noreferrer" style={link}>
            requests@soaralarm.eu
          </a>.
        </p>

        <p style={p}>
          <b style={{ color: '#dedede' }}>For requesting new spots (including other countries)</b>:
        </p>

        <ul style={{ ...p, paddingLeft: 20 }}>
          <li>
            Spot name.
          </li>
          <li>
            Exact coordinates of the takeoff.
          </li>
          <li>
            Steepness of the slope in degrees, or alternatively a few good pictures in which the angle of the slope is clearly visible.
          </li>
          <li>
            Height of the dune/hill in meters.
          </li>
          <li>
            A description of the spot. Any regulations, peculiarities or good-to-knows, any hazards.
          </li>
          <li>
            The minimum and maximum windspeeds, and minimum and maximum headings/crosswind angles you can fly at the site, as well as your wing model and size, and your weight (including the wing and harness), so I can check that the computed wind and heading ranges are correct.
          </li>
        </ul>
        <p style={p}>Is your site dependent on sea-breeze that is caused by the sun, or other
          weather factors that are not well reflected in the forecasted wind? Contact me – I would like to try figuring it out.
        </p>
        <p style={p}>
          <b style={{ color: '#dedede' }}>Note</b>:
        </p>
        <ul style={{ ...p, paddingLeft: 20 }}>
          <li>
            Only soaring spots allowed for the time being.
          </li>
          <li>
            No spots where it's illegal or sketchy to fly.
          </li>
          <li>
            Only spots within Europe.
          </li>
        </ul>

        <p style={p}>
          Please do understand that this is a hobby project. Major decisions about the way the app works have already 
          been made, and the reasoning behind a lot of them is explained here, on the <b style={{ color: '#dedede' }}>Info tab</b>. Your feedback is 
          greatly appreciated, but bear in mind I probably won't be able to reply to every email.
        </p>
      </div>

      {/* ── GitHub link ── */}
      <div style={{ textAlign: 'center', padding: '8px 0 24px', fontSize: fs(15), color: '#555' }}>
        <a
          href="https://github.com/ejerez/soaralarm-nl"
          target="_blank"
          rel="noopener noreferrer"
          style={{ ...link, color: '#9e9e9e' }}
        >
          Source code on GitHub
        </a>
      </div>

      {_diagOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setDiagOpen(false)}
        >
          <div
            style={{ background: '#262626', border: '1px solid #3d3d3d', borderRadius: 8, padding: '16px 20px', width: 320, maxWidth: '90vw', boxSizing: 'border-box' }}
            onClick={e => e.stopPropagation()}
          >
            <input
              type="text"
              value={_diagInput}
              onChange={e => setDiagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') _onDiagSubmit() }}
              placeholder="Enter command..."
              autoFocus
              style={{ width: '100%', background: '#2e2e2e', color: '#dedede', border: '1px solid #484848', borderRadius: 6, padding: '6px 10px', fontSize: fs(13), fontFamily: "'Atkinson Hyperlegible', system-ui, sans-serif", outline: 'none', marginBottom: 10, boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={_onDiagSubmit} style={{ background: '#5578e8', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: fs(13), cursor: 'pointer', fontFamily: "'Atkinson Hyperlegible', system-ui, sans-serif" }}>Enter</button>
              <button onClick={() => setDiagOpen(false)} style={{ background: '#2e2e2e', color: '#9a9a9a', border: '1px solid #484848', borderRadius: 6, padding: '6px 14px', fontSize: fs(13), cursor: 'pointer', fontFamily: "'Atkinson Hyperlegible', system-ui, sans-serif" }}>Close</button>
            </div>
            {_diagMsg && (
              <div style={{ fontSize: fs(12), color: _diagMsg === 'Unrecognised input.' ? '#c04040' : '#55e68f' }}>
                {_diagMsg}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  )
}

const th = {
  padding: '6px 10px',
  textAlign: 'left',
  color: '#aaa',
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

const td = {
  padding: '7px 10px',
  color: '#888',
  whiteSpace: 'nowrap',
}

const link = {
  color: '#7eb8f7',
  textDecoration: 'none',
}
