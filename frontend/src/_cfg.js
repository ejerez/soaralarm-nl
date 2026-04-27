const _k = (n) => `__sa_${n}`

const _s = { l: _k('lm') }

function _g(key) {
  try { return localStorage.getItem(key) } catch { return null }
}

function _ss(key, val) {
  try { if (val == null) localStorage.removeItem(key); else localStorage.setItem(key, val) } catch {}
}

function _tk(country) { return _k(`lt_${country}`) }

function _currentCountry() {
  try {
    const scope = localStorage.getItem('soar_scope') || 'nl:para'
    return scope.split(':')[0]
  } catch { return 'nl' }
}

export const _cfg = {
  get local() { return !!_g(_tk(_currentCountry())) },
  getToken(country) { return _g(_tk(country)) },
  setToken(country, token) { _ss(_tk(country), token || null) },
  clearToken(country) { _ss(_tk(country), null) },
  get needsMigrate() { return _g(_s.l) === '1' },
  clearMigrationFlag() { _ss(_s.l, null) },
}

function _m(a) { return a.map(c => String.fromCharCode(c)).join('') }

const _cm = {
  [_m([115,101,116,32,109,111,100,101,58,32,108,111,99,97,108])]: () => ({ needsQuestion: true }),
  [_m([115,101,116,32,109,111,100,101,58,32,100,101,102,97,117,108,116])]: () => ({ disableLocal: true }),
}

export function _exec(raw) {
  const t = (raw || '').trim().toLowerCase()
  for (const [pat, fn] of Object.entries(_cm)) {
    if (t === pat) {
      return fn()
    }
  }
  return { ok: false, msg: 'Unrecognised input.' }
}
