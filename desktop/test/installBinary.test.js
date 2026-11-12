'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const DESKTOP = path.join(__dirname, '..')

test('Electron is pinned to one exact version', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'object-desktop')
  assert.equal(pkg.private, true)
  assert.equal(pkg.devDependencies.electron, '45.3.0')
  const lock = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package-lock.json'), 'utf8'))
  assert.equal(lock.packages['node_modules/electron'].version, '45.3.0')
})

test('npm ci fetches the binary through the postinstall, which can be skipped', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts.postinstall, 'node install-binary.js')
  const result = spawnSync(process.execPath, [path.join(DESKTOP, 'install-binary.js')], {
    env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /was not downloaded/)
})
