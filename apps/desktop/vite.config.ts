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
        content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; frame-src http://127.0.0.1:*",
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
      main: {
        entry: 'electron/main.ts',
      },
      preload: {
        input: 'electron/preload.ts',
        // Sandboxed preload scripts must be CommonJS
        vite: { build: { rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } } },
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  build: {
    rolldownOptions: {
      output: {
        // Vendor code in its own chunks, so no chunk passes Vite's 500 kB warning and an app-only
        // change leaves the vendor files byte for byte the same
        codeSplitting: {
          groups: [
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 3 },
            { name: 'ui', test: /[\\/]node_modules[\\/](radix-ui|@radix-ui|@floating-ui|cmdk|react-resizable-panels)[\\/]/, priority: 2 },
            { name: 'icons', test: /[\\/]node_modules[\\/]lucide-react[\\/]/, priority: 2 },
            { name: 'vendor', test: /[\\/]node_modules[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
})
