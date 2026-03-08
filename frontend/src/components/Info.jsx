import React from 'react'

const DEFAULT_WEIGHT = 75.0

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
  background: '#1e1e2e',
  border: '1px solid #2a2a3e',
  borderRadius: 8,
  padding: '20px 24px',
  marginBottom: 20,
}

const h2 = { fontSize: 16, fontWeight: 600, color: '#ccc', marginBottom: 12, marginTop: 0 }
const h3 = { fontSize: 14, fontWeight: 600, color: '#aaa', marginBottom: 8, marginTop: 16 }
const p  = { fontSize: 13, color: '#888', lineHeight: 1.7, margin: '0 0 8px' }

const code = {
  display: 'inline-block',
  background: '#252535',
  border: '1px solid #3a3a5e',
  borderRadius: 4,
  padding: '2px 8px',
  fontFamily: 'monospace',
  fontSize: 13,
  color: '#a0ccfc',
  margin: '4px 0',
}

export default function Info({ data }) {
  const { points, wings, selectedWings, weight } = data
  const w = parseFloat(weight) || DEFAULT_WEIGHT

  // Wings to show: fall back to all wing keys if nothing selected
  const wingKeys  = Object.keys(wings)
  const activeWings = selectedWings.length > 0 ? selectedWings : wingKeys.map(k => ({
    key: k, size: wings[k].default_size,
  }))

  return (
    <div style={{ maxWidth: 720 }}>

      {/* ── How flyability is calculated ── */}
      <div style={card}>
        <h2 style={h2}>Flyability calculation:</h2>

        <p style={p}>
          The flyable wind ranges and wind headings are calculated based on an experienced pilot of{' '}
          <b style={{ color: '#ccc' }}>75 kg</b> flying the following wings:
        </p>

        <ul style={{ ...p, paddingLeft: 20 }}>
          {wingKeys.map(k => (
            <li key={k}>
              <b style={{ color: '#ccc' }}>{wings[k].display_name}</b>
              {' → '}
              {k === 'scraper_16'   && 'Dune Rider Scraper 16 m²'}
              {k === 'hopper_16'    && 'Dune Rider Hopper 16 m²'}
              {k === 'paraglider_22' && 'EN-C wing 22 m²'}
              {!['scraper_16','hopper_16','paraglider_22'].includes(k) &&
                `${wings[k].display_name} ${wings[k].default_size} m²`}
            </li>
          ))}
        </ul>

        <h3 style={h3}>Wind range scaling:</h3>
        <p style={p}>
          Wind ranges for different sizes and pilot weights are derived from the base ranges by solving
          for constant lift coefficient:
        </p>
        <div style={{ ...code, display: 'block', padding: '8px 14px', margin: '8px 0 12px' }}>
          v₂ = v₁ · √((W₂/W₁) · (A₁/A₂))
        </div>
        <p style={p}>
          where <i>v</i> is airspeed, <i>W</i> is total pilot weight in flight, and <i>A</i> is wing area.
          This assumes the glide ratio is the same across all sizes and weights for a given wing type,
          which is a simplification.
        </p>

        <h3 style={h3}>Wind quality</h3>
        <p style={p}>
          Each hour is classified by wind direction relative to the site's ideal heading, with conditions
          considered "gusty" when the forecasted gusts exceed the forecasted windspeed by more than 20 km/h.
        </p>
        <ul style={{ ...p, paddingLeft: 20 }}>
          <li><b style={{ color: '#1fd100' }}>Good wind</b> — Comfortable wind heading.</li>
          <li><b style={{ color: '#d68800' }}>Crosswind</b> — Noticeably cross.</li>
          <li><b style={{ color: '#c12e0d' }}>Gusty</b> — Good wind heading, gusts &gt; 20 km/h over windspeed.</li>
          <li><b style={{ color: '#80220d' }}>Crosswind, Gusty</b> — Noticeably cross, gusts &gt; 20 km/h over windspeed.</li>
        </ul>
        <p style={p}>
          An hour counts as flyable only if the wind speed is within range for at least one of the selected
          wings, with precipitation ≤ 0.1 mm and visibility &gt; 300 m.
        </p>
      </div>

      {/* ── Per-point table ── */}
      <div style={card}>
        <h2 style={h2}>Wind ranges and headings per location</h2>
        <p style={{ ...p, marginBottom: 16 }}>
          Values for the current selection in "Settings":{' '}
          {activeWings.map((aw, i) => (
            <span key={aw.key}>
              <b style={{ color: '#ccc' }}>{wings[aw.key]?.display_name ?? aw.key}</b>{' '}
              {aw.size} m²{i < activeWings.length - 1 ? ', ' : ''}
            </span>
          ))}
          {' '}at <b style={{ color: '#ccc' }}>{w} kg</b>.
        </p>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #3a3a5e' }}>
                <th style={th}>Location</th>
                <th style={th}>Heading</th>
                <th style={th}>Good range</th>
                <th style={th}>Cross range</th>
                {activeWings.map(aw => (
                  <th key={aw.key} style={th}>
                    {wings[aw.key]?.display_name ?? aw.key}<br />
                    <span style={{ color: '#666', fontWeight: 400 }}>{aw.size} m² wind (km/h)</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((pt, i) => (
                <tr key={pt.name} style={{ borderBottom: '1px solid #252535', background: i % 2 === 0 ? 'transparent' : '#1a1a28' }}>
                  <td style={td}><b style={{ color: '#ccc' }}>{pt.name}</b></td>
                  <td style={{ ...td, color: '#a0ccfc' }}>{wrapDeg(pt.heading)}°</td>
                  <td style={td}>
                    {wrapDeg(pt.heading + pt.head_range.good[0])}° –{' '}
                    {wrapDeg(pt.heading + pt.head_range.good[1])}°
                  </td>
                  <td style={td}>
                    {wrapDeg(pt.heading + pt.head_range.cross[0])}° –{' '}
                    {wrapDeg(pt.heading + pt.head_range.cross[1])}°
                  </td>
                  {activeWings.map(aw => {
                    const base = pt.wind_range?.[aw.key]
                    if (!base) return <td key={aw.key} style={{ ...td, color: '#555' }}>—</td>
                    const [mn, mx] = effectiveRange(base, wings[aw.key].default_size, aw.size, w)
                    return (
                      <td key={aw.key} style={td}>
                        <span style={{ color: '#6be655' }}>{mn}</span>
                        {' – '}
                        <span style={{ color: '#55e68f' }}>{mx}</span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Data sources ── */}
      <div style={card}>
        <h2 style={h2}>Data sources</h2>

        <h3 style={{ ...h3, marginTop: 0 }}>Wind &amp; weather forecast</h3>
        <p style={p}>
          Forecasts are fetched from the{' '}
          <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" style={link}>
            Open-Meteo API
          </a>
          , a FOS weather API. The two models used are:
        </p>
        <ul style={{ ...p, paddingLeft: 20 }}>
          <li>
            <b style={{ color: '#ccc' }}>KNMI Seamless</b> – Uses the KNMI HARMONIE AROME 2 km resolution 
            model for the next 2.5 days, and afterwards uses ECMWF IFS forecasts.
          </li>
          <li>
            <b style={{ color: '#ccc' }}>ECMWF IFS</b> – 9 km resolution forecasts from the European Centre
            for Medium-Range Weather Forecasts.
          </li>
        </ul>
        <p style={p}>
          Wind speed, direction, and gusts are sampled at hand-picked, offshore, upwind coordinates for each 
          location, while temperature, visibility, and precipitation are sampled at the flying site, onshore. 
          Forecasts are refreshed every 2 hours.
        </p>

        <h3 style={h3}>Live wind measurements</h3>
        <p style={p}>
          Real-time wind measurements are pulled from the{' '}
          <a href="https://rijkswaterstaatdata.nl/waterdata/" target="_blank" rel="noopener noreferrer" style={link}>
            Rijkswaterstaat Waterinfo API
          </a>{' '}
          via the open-source{' '}
          <a href="https://github.com/Deltares/ddlpy" target="_blank" rel="noopener noreferrer" style={link}>
            ddlpy
          </a>{' '}
          library. The measurements used are the wind spreads (only available from certain weather stations) and wind 
          heading reported every 10-minutes by RWS coastal monitoring stations. Data is refreshed every
          15 minutes, only during the daylight window (from 60 minutes before sunrise to 60 minutes after sunset).
        </p>
      </div>

      {/* ── GitHub link ── */}
      <div style={{ textAlign: 'center', padding: '8px 0 24px', fontSize: 15, color: '#555' }}>
        <a
          href="https://github.com/ejerez/soaralarm-nl"
          target="_blank"
          rel="noopener noreferrer"
          style={{ ...link, color: '#555' }}
        >
          Source code on GitHub
        </a>
      </div>

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