'use strict'
// Run by `npm ci` / `npm install` (this package's postinstall).
//
// Electron's npm package (45) no longer downloads its binary when it is installed: it does so
// the first time `electron` is run through npm. `objectapp` starts the binary itself (it reads
// `node_modules/electron/path.txt`), so the binary is fetched here, once, at install time.
// ELECTRON_SKIP_BINARY_DOWNLOAD=1 skips it (for running the unit tests only, or where the
// binary is put in place by hand).

const { spawnSync } = require('node:child_process')

if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
  console.log('object-desktop: ELECTRON_SKIP_BINARY_DOWNLOAD is set; the Electron binary was not downloaded.')
  process.exit(0)
}

const result = spawnSync(process.execPath, [require.resolve('electron/install.js')], { stdio: 'inherit' })
process.exit(result.status === null ? 1 : result.status)
