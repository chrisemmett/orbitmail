#!/usr/bin/env node
// Integration test runner: starts a GreenMail server in Docker, builds the
// suite, and runs it inside a windowless Electron main process (the app's DB
// layer needs `app.getPath`, and better-sqlite3 is built against Electron's
// ABI). Tears the container down on the way out, including on Ctrl-C.
//
//   npm run test:imap            run everything
//   npm run test:imap -- --keep  leave the container running afterwards
//
// The suite talks to the real IMAP/SMTP server over the ports below; nothing is
// mocked except the clock in the unit-level checks.
import { spawn, spawnSync } from 'child_process'
import { mkdirSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  IMAGE, USER, dockerAvailable, startGreenMail, stopContainer, containerLogs, waitForImap
} from './greenmail.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD_DIR = join(ROOT, '.integration-build')
const CONTAINER = 'orbit-mail-greenmail-test'

export const PORTS = { imap: 3143, imaps: 3993, smtp: 3025 }

const keep = process.argv.includes('--keep')
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts })

function fail(message) {
  console.error(`\n[test:imap] ${message}`)
  process.exit(1)
}

function buildSuite() {
  mkdirSync(BUILD_DIR, { recursive: true })
  const out = join(BUILD_DIR, 'suite.cjs')
  // Bundle to CJS for the Electron main process. Native and Electron-provided
  // modules stay external so they resolve at runtime from node_modules.
  const res = run(join(ROOT, 'node_modules', '.bin', 'esbuild'), [
    join(ROOT, 'scripts', 'imap-integration.suite.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--external:electron',
    '--external:better-sqlite3',
    `--outfile=${out}`,
    '--log-level=warning'
  ], { cwd: ROOT })
  if (res.status !== 0) fail(`could not build the suite:\n${res.stdout}\n${res.stderr}`)
  if (res.stderr) process.stderr.write(res.stderr)
  return out
}

function runSuite(entry) {
  return new Promise((resolve) => {
    const electron = join(ROOT, 'node_modules', '.bin', 'electron')
    // Electron initialises Ozone even with no window, so on a machine with no
    // X server (CI) it exits with "Missing X server or $DISPLAY". The headless
    // Ozone platform avoids that without needing xvfb. Only applied when there
    // is genuinely no display, so local runs behave exactly as before.
    const headless = !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
    const args = ['--no-sandbox', ...(headless ? ['--ozone-platform=headless'] : []), entry]
    const child = spawn(electron, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        // The dev shell sets this; with it set, Electron runs as plain Node and
        // `app` is undefined.
        ELECTRON_RUN_AS_NODE: '',
        ORBIT_TEST_CONTAINER: CONTAINER,
        ORBIT_TEST_IMAP_PORT: String(PORTS.imap),
        ORBIT_TEST_SMTP_PORT: String(PORTS.smtp),
        ORBIT_TEST_EMAIL: USER.email,
        ORBIT_TEST_LOGIN: USER.login,
        ORBIT_TEST_PASSWORD: USER.password
      }
    })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

let cleanedUp = false
function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  if (!keep) stopContainer(CONTAINER)
  rmSync(BUILD_DIR, { recursive: true, force: true })
}
process.on('SIGINT', () => { cleanup(); process.exit(130) })
process.on('SIGTERM', () => { cleanup(); process.exit(143) })

if (!dockerAvailable()) {
  fail('Docker is not available. This suite needs it to run GreenMail.')
}

console.log(`[test:imap] starting ${IMAGE} as ${CONTAINER}`)
const startError = startGreenMail({ container: CONTAINER, ports: PORTS })
if (startError) fail(`could not start GreenMail:\n${startError}`)
if (!(await waitForImap(PORTS.imap))) {
  fail('GreenMail did not accept IMAP connections in time')
}
console.log(`[test:imap] GreenMail ready on imap:${PORTS.imap} smtp:${PORTS.smtp}\n`)

let code = 1
try {
  code = await runSuite(buildSuite())
  if (code !== 0) {
    // Dump the server's view before the container goes away — on CI this is the
    // only chance to see why a protocol-level check failed.
    console.log(`\n[test:imap] GreenMail log (last 40 lines):`)
    process.stdout.write(containerLogs(CONTAINER))
  }
} finally {
  cleanup()
  if (keep) console.log(`\n[test:imap] container ${CONTAINER} left running (--keep)`)
}
process.exit(code)
