import React, { useState, useEffect } from 'react'
import { fs } from '../fs.js'
import { api } from '../api.js'

const T = {
  bg:        '#1a1a1a',
  card:      '#262626',
  border:    '#3d3d3d',
  borderDim: '#353535',
  text:      '#dedede',
  text2:     '#9a9a9a',
  text3:     '#757575',
  accent:    '#5578e8',
  font:      "'Atkinson Hyperlegible', system-ui, sans-serif",
}

const STORAGE_KEY = 'soar_whatsnew_version'

export default function WhatsNew() {
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    api.whatsnew().then(d => {
      const seen = parseFloat(localStorage.getItem(STORAGE_KEY) || '0')
      if (d.version > seen) {
        setData(d)
        setOpen(true)
      }
    }).catch(() => {})
  }, [])

  function dismiss() {
    if (data) localStorage.setItem(STORAGE_KEY, String(data.version))
    setOpen(false)
  }

  if (!open || !data) return null

  return (
    <div onClick={dismiss} style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.card, border: `1px solid ${T.border}`,
        borderRadius: 10, padding: '24px 28px',
        maxWidth: 420, width: '100%',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        fontFamily: T.font, color: T.text,
        maxHeight: '80vh', overflowY: 'auto',
      }}>
        <div style={{ fontSize: fs(18), fontWeight: 700, marginBottom: 18 }}>
          What's New?
        </div>

        {data.features.map((f, i) => (
          <div key={i} style={{ marginBottom: i < data.features.length - 1 ? 16 : 0 }}>
            <div style={{ fontSize: fs(14), fontWeight: 600, color: T.text, marginBottom: 4 }}>
              {f.feature}
            </div>
            <div
              style={{ fontSize: fs(13), color: T.text2, lineHeight: 1.55 }}
              dangerouslySetInnerHTML={{ __html: f.message }}
            />
          </div>
        ))}

        <button onClick={dismiss} style={{
          marginTop: 20, width: '100%',
          background: T.accent, color: '#fff', border: 'none',
          borderRadius: 6, padding: '10px 0',
          fontSize: fs(14), fontWeight: 600, cursor: 'pointer',
          fontFamily: T.font,
        }}>
          Got it
        </button>
      </div>
    </div>
  )
}
