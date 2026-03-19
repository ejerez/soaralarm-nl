import React from 'react'

const h3 = { fontSize: 11, fontWeight: 600, color: '#9a9a9a', marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: '0.04em' }
const p  = { fontSize: 13, color: '#9a9a9a', lineHeight: 1.7, margin: '0 0 8px' }
const link = { color: '#7eb8f7', textDecoration: 'none' }
const th = { padding: '6px 10px', textAlign: 'left', color: '#aaa', fontWeight: 600, whiteSpace: 'nowrap' }
const td = { padding: '7px 10px', color: '#888', whiteSpace: 'nowrap' }

export default function DataSources_nl() {
  return (
    <>
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
        Real-time wind measurements are pulled from multiple station APIs. The primary source is the{' '}
        <a href="https://rijkswaterstaatdata.nl/waterdata/" target="_blank" rel="noopener noreferrer" style={link}>
          Rijkswaterstaat (RWS) Waterinfo API
        </a>{' '}
        via the open-source{' '}
        <a href="https://github.com/Deltares/ddlpy" target="_blank" rel="noopener noreferrer" style={link}>
          ddlpy
        </a>{' '}
        library. Some locations also have an <b style={{ color: '#dedede' }}>alternative station</b> from
        the NKV (Nederlands Kitesurf Vereniging) network, selectable on the Point tab with radio buttons.
      </p>
      <p style={p}>
        Measurements include wind speed spreads (min/max) and wind heading, reported every 10 minutes.
        Data is refreshed every 15 minutes, only during the <b style={{ color: '#dedede' }}>daylight
        window</b> (from 90 minutes before sunrise to 90 minutes after sunset). Outside this window,
        the Data Status in Settings shows "Night" instead of "Stale".
      </p>
    </>
  )
}
