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
  background: '#262626',
  border: '1px solid #1e1e32',
  borderRadius: 8,
  padding: '20px 24px',
  marginBottom: 16,
}
const h2 = { fontSize: 15, fontWeight: 600, color: '#dedede', marginBottom: 12, marginTop: 0 }
const h3 = { fontSize: 11, fontWeight: 600, color: '#9a9a9a', marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: '0.04em' }
const p  = { fontSize: 13, color: '#9a9a9a', lineHeight: 1.7, margin: '0 0 8px' }

const code = {
  display: 'inline-block',
  background: '#2e2e2e',
  border: '1px solid #777777',
  borderRadius: 4,
  padding: '2px 8px',
  fontFamily: 'monospace',
  fontSize: 13,
  color: '#cccccc',
  margin: '4px 0',
}

export default function Info({ data }) {
  const { points, wings, selectedWings, weight, customWind, windMin, windMax } = data
  const w = parseFloat(weight) || DEFAULT_WEIGHT

  // Wings to show: fall back to all wing keys if nothing selected
  const wingKeys  = Object.keys(wings)
  const activeWings = selectedWings.length > 0 ? selectedWings : wingKeys.map(k => ({
    key: k, size: wings[k].default_size,
  }))

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={card}>
        <img
          src="/paraglider.png"
          style={{ display: 'block', width: 'clamp(250px, 14vw, 350px)', opacity: 0.9, marginBottom: 16 }}
          alt=""
        />
        <h2 style={h2}>About Soaralarm NL</h2>
        <p style={{ ...p, margin: 0 }}>
          Soaralarm NL is a <b style={{ color: '#dedede' }}>free and open-source</b> project,
          built as a free service for the community of pilots who soar the dunes along the
          Dutch coast. It combines offshore wind forecasts using four major European weather models
          with live RWS measurements to give you an overview of the best spots to fly in the
          upcoming 7 days, plus detailed forecasts and measurements to judge the conditions 
          when you go fly.
        </p>
      </div>

      {/* ── How flyability is calculated ── */}
      <div style={card}>
        <h2 style={h2}>Flyability calculation</h2>

        <p style={p}>
          The flyable wind ranges and wind headings are calculated based on an experienced pilot of{' '}
          <b style={{ color: '#dedede' }}>75 kg</b> flying the following wings:
        </p>

        <ul style={{ ...p, paddingLeft: 20 }}>
          {wingKeys.map(k => (
            <li key={k}>
              <b style={{ color: '#dedede' }}>{wings[k].display_name}</b>
              {' → '}
              {k === 'scraper_16'   && 'Dune Rider Scraper 16 m²'}
              {k === 'hopper_16'    && 'Dune Rider Hopper 16 m²'}
              {k === 'paraglider_22' && 'EN-C wing 22 m²'}
              {!['scraper_16','hopper_16','paraglider_22'].includes(k) &&
                `${wings[k].display_name} ${wings[k].default_size} m²`}
            </li>
          ))}
        </ul>

        <h3 style={h3}>Wind range scaling</h3>
        <p style={p}>
          Wind ranges for different sizes and pilot weights are derived from the base ranges by solving
          for constant lift:
        </p>
        <div style={{ ...code, display: 'block', padding: '8px 14px', margin: '8px 0 12px' }}>
          v₂ = v₁ · √((W₂/W₁) · (A₁/A₂))
        </div>
        <p style={p}>
          where <i>v</i> is airspeed, <i>W</i> is total pilot weight in flight, and <i>A</i> is wing area.
          This assumes the glide ratio and lift coefficient are the same across all sizes and weights for a
          given wing type, which is a simplification but close enough in most cases.
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

      <div style={card}>
        <h2 style={h2}>Low end of wind ranges</h2>
        <p style={p}>
          While different wings have different glide ratios, most wings have a similar c<sub>L max</sub>, and in any case the main limitations on the low end
          of the range are the takeoff options, dune geometry and pilot skill – not the efficiency of the wing. 
        </p>
        <p style={p}>
          This is trivial to show: the windspeeds theoretically required to achieve an upwards component of wind equal to the minimum sink 
          of a wing like a Scraper 16 are much lower than the 
          actual low range of the wing, in the order of around 10-15 km/h for the moderate quality dunes in the NW facing sites, but the wing must 
          trade altitude to accelerate beyond stall speed before it can use the lift to stay up. 
        </p> 
        <p style={p}>
          Given these considerations, and in order to simplify a quite complex topic, the minimum flyable 
          speed for each wing has been assumed to be solely a function of wing area and location (that is,
          all types of wings with the same area will show the same minimum speed at a given location).
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
            ? <span>Custom wind range <b style={{ color: '#6be655' }}>{windMin}</b> – <b style={{ color: '#55e68f' }}>{windMax}</b> km/h</span>
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #686868' }}>
                <th style={th}>Location</th>
                <th style={th}>Heading</th>
                <th style={th}>Good range</th>
                <th style={th}>Cross range</th>
                {customWind
                  ? <th style={th}>Wind (km/h)<br /><span style={{ color: '#828282', fontWeight: 400 }}>custom range</span></th>
                  : activeWings.map(aw => (
                      <th key={aw.key} style={th}>
                        {wings[aw.key]?.display_name ?? aw.key}<br />
                        {aw.size} m² <span style={{ color: '#828282', fontWeight: 400 }}>[km/h]</span>
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
                    {wrapDeg(pt.heading + pt.head_range.good[0])}° –{' '}
                    {wrapDeg(pt.heading + pt.head_range.good[1])}°
                  </td>
                  <td style={td}>
                    {wrapDeg(pt.heading + pt.head_range.cross[0])}° –{' '}
                    {wrapDeg(pt.heading + pt.head_range.cross[1])}°
                  </td>
                  {customWind
                    ? <td style={td}>
                        <span style={{ color: '#6be655' }}>{windMin}</span>
                        {' – '}
                        <span style={{ color: '#55e68f' }}>{windMax}</span>
                      </td>
                    : activeWings.map(aw => {
                        const base = pt.wind_range?.[aw.key]
                        if (!base) return <td key={aw.key} style={{ ...td, color: '#555' }}>–</td>
                        const [mn, mx] = effectiveRange(base, wings[aw.key].default_size, aw.size, w)
                        return (
                          <td key={aw.key} style={td}>
                            <span style={{ color: '#6be655' }}>{mn}</span>
                            {' – '}
                            <span style={{ color: '#55e68f' }}>{mx}</span>
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

      {/* ── Data sources ── */}
      <div style={card}>
        <h2 style={h2}>Data sources</h2>

        <h3 style={{ ...h3, marginTop: 0 }}>Wind &amp; weather forecast</h3>
        <p style={p}>
          Forecasts are fetched from the{' '}
          <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" style={link}>
            Open-Meteo API
          </a>
          , a free and open-source weather API. The active model is selected in Settings.
        </p>
        <ul style={{ ...p, paddingLeft: 20 }}>
          <li>
            <b style={{ color: '#dedede' }}>KNMI HARMONIE</b> – 2 km resolution. Uses KNMI HARMONIE AROME
            for the first 2.5 days, then blends into ECMWF IFS for the remainder of the forecast.
          </li>
          <li>
            <b style={{ color: '#dedede' }}>ECMWF IFS</b> – 9 km resolution global model from the European
            Centre for Medium-Range Weather Forecasts. Most reliable for days 4–7.
          </li>
          <li>
            <b style={{ color: '#dedede' }}>DWD ICON D2</b> – 2 km resolution model from Deutscher
            Wetterdienst. Uses ICON D2 for the first 2 days, and ICON EU afterwards. From 78h into the future,
            forecasted values are only 3-hourly and therefore interpolated for each hour in-between.
          </li>
          <li>
            <b style={{ color: '#dedede' }}>Météo-France AROME HD</b> – 1.5 km resolution. Visibility is 
            not provided by this model and is patched in from KNMI HARMONIE. Forecast only for up to 4 days
            into the future.
          </li>
        </ul>
        <p style={p}>
          Wind speed, direction, and gusts are sampled at hand-picked, offshore, upwind coordinates for each
          location, while temperature, visibility, and precipitation are sampled at the flying site, onshore.
          Forecasts are refreshed every 2 hours.
        </p>

        <h3 style={h3}>Multi-model confidence scores</h3>
        <p style={p}>
          For each day, every location is scored by how many of the four models agree there will be flyable
          hours <b style={{ color: '#dedede' }}>based solely on wind speed and heading</b>, that is, ignoring rain
          or fog – since these tend to introduce quite some variability to the calculation of flyability, and 
          their forecasted values are usually more volatile than the forecasted wind. The location with 
          the highest score is selected as the "best" location shown in the
          flyable-hours chart, Gantt chart, and Point Forecast default. When multiple locations share the
          same score, the selected model's good-quality hours – and then total flyable hours  – are used as
          a tie-breaker. The badge is shown whenever at least one model forecasts flyable weather.
        </p>
        <p style={p}>
          Beyond day 3, KNMI is excluded because it blends into ECMWF IFS after 2.5 days – including it
          would double-count the same source. From day 5 onward, AROME doesn't produce any forecasts, leaving
          only ECMWF and ICON.
        </p>

        {/* Confidence score table */}
        <div style={{ overflowX: 'auto', marginBottom: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #676767' }}>
                <th style={th}>Badge</th>
                <th style={th}>Models agree</th>
                <th style={th}>Available until</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: '★★★★', color: '#00e676', agree: '4 / 4', until: 'Third day from today (all 4 models active)' },
                { label: '★★★',   color: '#c6ef00', agree: '3 / 4', until: 'Fourth day from today (AROME still active)' },
                { label: '★★',     color: '#ffa726', agree: '2 / 4', until: 'Always possible' },
                { label: '★',       color: '#ef5350', agree: '1 / 4', until: 'Always possible' },
              ].map(({ label, color, agree, until }, i) => (
                <tr key={label} style={{ borderBottom: '1px solid #363636', background: i % 2 === 0 ? 'transparent' : '#363636' }}>
                  <td style={td}>
                    <span style={{
                      display: 'inline-block',
                      background: color + '22',
                      color,
                      fontWeight: 700,
                      fontSize: 11,
                      padding: '2px 7px',
                      borderRadius: 4,
                    }}>{label}</span>
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace', color: '#aaa' }}>{agree}</td>
                  <td style={td}>{until}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

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
          library. The measurements used are the wind spreads and wind heading reported every 10 minutes by
          RWS coastal monitoring stations. Data is refreshed every 15 minutes, only during the daylight
          window (from 90 minutes before sunrise to 90 minutes after sunset).
        </p>
      </div>
      
      <div style={card}>
        <h2 style={h2}>Credits</h2>
        <p style={p}>
          This web app was made possible by the help of some of the awesome pilots who soar the dunes frequently, 
          including <b style={{ color: '#dedede' }}>Simon</b> from{' '}
          <a href="https://paraglidingisfun.com/" target="_blank" rel="noopener noreferrer" style={link}>
            Paragliding is Fun 
          </a>{' '}
          and <b style={{ color: '#dedede' }}>Bryan</b> from{' '}
          <a href="https://www.dune-rider.com/" target="_blank" rel="noopener noreferrer" style={link}>
            Dune Rider 
          </a>,{' '}
          whose fantastic wings introduced me to the life-changing art of dune soaring.
        </p>

        <p style={p}>
          It was also made possible by{' '}
          <a href="https://www.anthropic.com/claude" target="_blank" rel="noopener noreferrer" style={link}>
            Claude
          </a>{' '}
          by Anthropic, which helped enormously in the design of the web service architecture and frontend development, given my 
          limited experience in this kind of development and how little time I have available to work on this project.{' '}
          <b style={{ color: '#dedede' }}>Claude</b> helped in planning the backend architecture{' '}
          with <b style={{ color: '#dedede' }}>FastAPI</b>, developing most of the frontend with{' '}
          <b style={{ color: '#dedede' }}>React.js</b> and helping add features and solve issues at a much faster rate than I could by hand.
        </p>
      </div>

      <div style={card}>
        <h2 style={h2}>Privacy</h2>
        <p style={p}>
          Since I do not have the experience to be able to identify any security issues in the web app architecture, the decision was simply made 
          to not collect any data from the user. All your settings and preferences are only stored locally in your browser, and Soaralarm NL does 
          not collect or store any information of any kind about its users.
        </p>
      </div>

      {/* ── GitHub link ── */}
      <div style={{ textAlign: 'center', padding: '8px 0 24px', fontSize: 15, color: '#555' }}>
        <a
          href="https://github.com/ejerez/soaralarm-nl"
          target="_blank"
          rel="noopener noreferrer"
          style={{ ...link, color: '#9e9e9e' }}
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
