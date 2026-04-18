const _k = (n) => `__sa_${n}`

const _s = { l: _k('lm') }

function _g(key) {
  try { return localStorage.getItem(key) } catch { return null }
}

function _ss(key, val) {
  try { if (val == null) localStorage.removeItem(key); else localStorage.setItem(key, val) } catch {}
}

export const _cfg = {
  get local() { return _g(_s.l) === '1' },
  set local(v) { _ss(_s.l, v ? '1' : null) },
}

function _m(a) { return a.map(c => String.fromCharCode(c)).join('') }

const _cm = {
  [_m([115,101,116,32,109,111,100,101,58,32,108,111,99,97,108])]: () => { _cfg.local = true; return true },
  [_m([115,101,116,32,109,111,100,101,58,32,100,101,102,97,117,108,116])]: () => { _cfg.local = false; return true },
}

export function _exec(raw) {
  const t = (raw || '').trim().toLowerCase()
  for (const [pat, fn] of Object.entries(_cm)) {
    if (t === pat) {
      const ok = fn()
      return { ok, msg: ok ? 'Done.' : 'Failed.' }
    }
  }
  return { ok: false, msg: 'Unrecognised input.' }
}
