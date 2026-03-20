// Font-size scaling helpers.
// All fontSize values go through these so they respond to the --fs CSS custom property.
// Usage: fontSize: fs(13)  →  'calc(var(--fs, 1) * 13px)'
// Usage: fontSize: fsc(8, '1.4vw', 12)  →  'clamp(calc(var(--fs,1)*8px), 1.4vw, calc(var(--fs,1)*12px))'
export const fs = (px) => `calc(var(--fs, 1) * ${px}px)`
export const fsc = (min, vw, max) => `clamp(calc(var(--fs, 1) * ${min}px), ${vw}, calc(var(--fs, 1) * ${max}px))`
