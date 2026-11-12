'use strict'
// Where the window's own buttons are, as the bridge's `controls` says it:
// 'overlay' (Windows draws them at the top right), 'traffic' (macOS, top left),
// 'custom' (Linux: the page draws them), 'none' (no buttons: a tiling compositor, the
// "Window buttons" setting on "Hide", or the system's ordinary frame with `--frame system`).

/** Compositors where windows have no buttons (XDG_CURRENT_DESKTOP / XDG_SESSION_DESKTOP). */
const TILING = ['hyprland', 'sway', 'i3', 'river', 'niri', 'bspwm', 'dwm', 'qtile', 'xmonad', 'awesome']

function isTiling(env) {
  const names = [env.XDG_CURRENT_DESKTOP, env.XDG_SESSION_DESKTOP]
    .filter((v) => typeof v === 'string')
    .flatMap((v) => v.split(':'))
    .map((v) => v.trim().toLowerCase())
  return names.some((n) => TILING.includes(n))
}

/**
 * @param {string} platform  process.platform
 * @param {object} env       process.env
 * @param {string} [setting] the device setting "Window buttons": 'auto' | 'show' | 'hide' (Linux only)
 * @param {string} [frame]   'hidden' (default) | 'system'
 */
function controlsFor(platform, env, setting = 'auto', frame = 'hidden') {
  if (frame === 'system') return 'none'
  if (platform === 'win32') return 'overlay'
  if (platform === 'darwin') return 'traffic'
  if (setting === 'show') return 'custom'
  if (setting === 'hide') return 'none'
  return isTiling(env || {}) ? 'none' : 'custom'
}

module.exports = { TILING, isTiling, controlsFor }
