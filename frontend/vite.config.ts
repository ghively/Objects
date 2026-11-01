/// <reference types="vitest/config" />
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/** The Inter faces the shell paints with (fontsource's latin subsets; the weights the chrome uses). */
const PRELOAD_FONT = /inter-latin-(400|500|600)-normal[^/]*\.woff2$/

/**
 * Preload those woff2 files (hashed names, known only once the bundle is written), so the browser
 * asks for them with the entry instead of after the CSS has been parsed (audit 2026-11-01).
 */
function preloadFonts(): Plugin {
  return {
    name: 'object-preload-fonts',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.bundle) return
        return Object.keys(ctx.bundle)
          .filter((name) => PRELOAD_FONT.test(name))
          .sort()
          .map((name) => ({
            tag: 'link',
            attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: '', href: `/${name}` },
            injectTo: 'head' as const,
          }))
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), preloadFonts()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8790',
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Shared by the entry and the lazy pages (graph, calendar, whiteboard, raw mode, settings),
        // so no page chunk carries its own copy of React or of the editor's core.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'editor-core', test: /node_modules[\\/](@tiptap|prosemirror-[a-z-]+)[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
