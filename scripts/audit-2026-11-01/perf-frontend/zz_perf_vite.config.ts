import { defineConfig, mergeConfig } from 'vite'
import fs from 'node:fs'
import base from './vite.config'
const OUT = '/tmp/claude-0/-home-user-Objects/925c9253-6d40-5f27-a712-45dc1ac4b9ca/scratchpad/build'
export default mergeConfig(base, defineConfig({
  build: {
    outDir: OUT + '/dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    rollupOptions: {
      plugins: [{
        name: 'zz-perf-report',
        generateBundle(_o: any, bundle: any) {
          const out: any = {}
          for (const [name, c] of Object.entries<any>(bundle)) {
            if (c.type !== 'chunk') continue
            const mods: any = {}
            for (const [id, m] of Object.entries<any>(c.modules ?? {})) mods[id] = m.renderedLength
            out[name] = { size: c.code.length, isEntry: c.isEntry, isDynamicEntry: c.isDynamicEntry, imports: c.imports, dynamicImports: c.dynamicImports, modules: mods }
          }
          fs.writeFileSync(OUT + '/chunks.json', JSON.stringify(out))
        },
      }],
    },
  },
}))
