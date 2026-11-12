'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { controlsFor, isTiling, TILING } = require('../lib/controls')

test('Windows and macOS use the system buttons whatever the setting', () => {
  for (const setting of ['auto', 'show', 'hide', undefined]) {
    assert.equal(controlsFor('win32', {}, setting), 'overlay')
    assert.equal(controlsFor('darwin', {}, setting), 'traffic')
  }
})

test('Linux draws its own buttons on an ordinary desktop', () => {
  assert.equal(controlsFor('linux', { XDG_CURRENT_DESKTOP: 'GNOME' }, 'auto'), 'custom')
  assert.equal(controlsFor('linux', { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }), 'custom')
  assert.equal(controlsFor('linux', { XDG_CURRENT_DESKTOP: 'KDE', XDG_SESSION_DESKTOP: 'plasma' }, 'auto'), 'custom')
  assert.equal(controlsFor('linux', {}, 'auto'), 'custom')
})

test('a tiling compositor gets no buttons', () => {
  assert.deepEqual(TILING, ['hyprland', 'sway', 'i3', 'river', 'niri', 'bspwm', 'dwm', 'qtile', 'xmonad', 'awesome'])
  for (const name of ['Hyprland', 'sway', 'i3', 'river', 'niri', 'bspwm', 'dwm', 'qtile', 'xmonad', 'awesome']) {
    assert.equal(controlsFor('linux', { XDG_CURRENT_DESKTOP: name }, 'auto'), 'none', name)
    assert.equal(controlsFor('linux', { XDG_SESSION_DESKTOP: name.toUpperCase() }, 'auto'), 'none', name)
  }
  assert.equal(controlsFor('linux', { XDG_CURRENT_DESKTOP: 'sway:wlroots' }), 'none')
  assert.equal(controlsFor('linux', { XDG_CURRENT_DESKTOP: 'GNOME', XDG_SESSION_DESKTOP: 'i3' }), 'none')
  assert.equal(isTiling({ XDG_CURRENT_DESKTOP: 'awesome-gnome' }), false)
  assert.equal(isTiling({}), false)
})

test('the Window buttons setting overrides the guess on Linux', () => {
  assert.equal(controlsFor('linux', { XDG_CURRENT_DESKTOP: 'Hyprland' }, 'show'), 'custom')
  assert.equal(controlsFor('linux', { XDG_CURRENT_DESKTOP: 'GNOME' }, 'hide'), 'none')
  assert.equal(controlsFor('linux', { XDG_CURRENT_DESKTOP: 'Hyprland' }, 'nonsense'), 'none')
})

test('with the system frame the page draws and reserves nothing, on every system', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    for (const setting of ['auto', 'show', 'hide']) {
      assert.equal(controlsFor(platform, { XDG_CURRENT_DESKTOP: 'GNOME' }, setting, 'system'), 'none')
    }
  }
  assert.equal(controlsFor('win32', {}, 'auto', 'hidden'), 'overlay')
})
