import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'vite'

const require = createRequire(import.meta.url)
const root = await mkdtemp(path.join(tmpdir(), 'dalliance-apps-smoke-'))
const desktop = path.join(root, 'desktop')
await mkdir(desktop)
await writeFile(path.join(desktop, 'package.json'), JSON.stringify({ type: 'module' }))
await cp('dist', path.join(desktop, 'dist'), { recursive: true })
await cp('dist-electron', path.join(desktop, 'dist-electron'), { recursive: true })
await build({ configFile: false, logLevel: 'warn', build: {
  outDir: path.join(root, 'runner'), emptyOutDir: true, target: 'node24',
  lib: { entry: 'electron/apps/smoke.ts', formats: ['es'], fileName: () => 'smoke.mjs' },
  rolldownOptions: { external: ['electron', /^node:/] },
} })
const env = { ...process.env, DALLIANCE_APPS_TEST_ROOT: root, DALLIANCE_APPS_TEST_DESKTOP: desktop, DALLIANCE_TEST_PYTHON: process.env.DALLIANCE_TEST_PYTHON ?? 'python3' }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(require('electron'), [path.join(root, 'runner/smoke.mjs')], { env, stdio: 'inherit' })
child.once('exit', (code) => { process.exitCode = code ?? 1 })
