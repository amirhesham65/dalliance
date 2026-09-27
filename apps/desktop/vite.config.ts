import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import electron from 'vite-plugin-electron/simple'

// Strict CSP for packaged builds only. The dev server needs inline scripts for React Fast Refresh.
const csp: Plugin = {
  name: 'dalliance-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:",
      },
      injectTo: 'head-prepend',
    },
  ],
}

export default defineConfig({
  // Relative asset paths, so the packaged app can load dist/index.html from disk
  base: './',
  plugins: [
    csp,
    react(),
    tailwindcss(),
    electron({
      main: { entry: 'electron/main.ts' },
      preload: {
        input: 'electron/preload.ts',
        // Sandboxed preload scripts must be CommonJS
        vite: { build: { rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } } },
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
})
