#!/usr/bin/env node
// Runner for the send end-to-end check: starts GreenMail in Docker, builds the
// harness, and runs it in a *windowed* Electron process against the built
// renderer. See scripts/send-e2e.suite.ts for what it asserts.
//
//   npm run test:send-e2e            build, run, tear down
//   npm run test:send-e2e -- --keep  leave the container running afterwards
//
// Unlike `test:imap` this one drives real BrowserWindows, which is the only way
// to reach the compose window's lifecycle — its `close` handler, the draft
// flush, and what happens to both after a send. That also means:
//
// - **It needs a display.** Headless Ozone segfaults as soon as a window is
//   created (hidden ones included), so there is no CI-friendly mode and this
//   script refuses to run without DISPLAY or WAYLAND_DISPLAY. `test:imap`
//   remains the suite that runs on every push.
// - **Windows appear on screen** for a few seconds, including a compose window.
// - The harness bundle is written into `out/main/` so that `__dirname` resolves
//   `../renderer` and `../preload` exactly as the real main bundle does. It is
//   deleted afterwards — a stray 6 MB file there would be packaged into the app.
import { spawn } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'
import {
  IMAGE, USER, dockerAvailable, startGreenMail, stopContainer, containerLogs, waitForImap
} from './greenmail.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONTAINER = 'orbit-mail-greenmail-e2e'
// Deliberately not test:imap's ports, so both can run at once and a container
// left behind by `test:imap -- --keep` does not collide with this one.
const PORTS = { imap: 3243, imaps: 4093, smtp: 3225 }
const BUNDLE = join(ROOT, 'out', 'main', 'send-e2e.cjs')
// The harness's app data. Owned here rather than inside the harness: deleting it
// from a still-running app just leaves SQLite to recreate the WAL behind you, so
// it goes once the process is gone.
const USER_DATA = mkdtempSync(join(tmpdir(), 'orbit-send-e2e-'))

const keep = process.argv.includes('--keep')

function fail(message) {
  // Via cleanup, so bailing out early (no display, no Docker) still takes the
  // temp app-data directory with it.
  cleanup()
  console.error(`\n[test:send-e2e] ${message}`)
  process.exit(1)
}

function buildHarness() {
  const res = spawnSync(join(ROOT, 'node_modules', '.bin', 'esbuild'), [
    join(ROOT, 'scripts', 'send-e2e.suite.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--external:electron',
    '--external:better-sqlite3',
    `--outfile=${BUNDLE}`,
    '--log-level=warning'
  ], { cwd: ROOT, encoding: 'utf8' })
  if (res.status !== 0) fail(`could not build the harness:\n${res.stdout}\n${res.stderr}`)
  if (res.stderr) process.stderr.write(res.stderr)
}

function runHarness() {
  return new Promise((resolve) => {
    const electron = join(ROOT, 'node_modules', '.bin', 'electron')
    const child = spawn(electron, ['--no-sandbox', '--disable-gpu', BUNDLE], {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        // The dev shell sets this; with it set, Electron runs as plain Node and
        // `app` is undefined.
        ELECTRON_RUN_AS_NODE: '',
        ORBIT_TEST_USERDATA: USER_DATA,
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
  rmSync(BUNDLE, { force: true })
  rmSync(USER_DATA, { recursive: true, force: true })
}
process.on('SIGINT', () => { cleanup(); process.exit(130) })
process.on('SIGTERM', () => { cleanup(); process.exit(143) })

if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  fail(
    'No display. This check drives real windows, and headless Ozone segfaults on\n' +
    'the first BrowserWindow, so there is no headless mode. Use `npm run test:imap`\n' +
    'for the windowless suite (that is the one CI runs).'
  )
}
if (!dockerAvailable()) {
  fail('Docker is not available. This check needs it to run GreenMail.')
}

console.log(`[test:send-e2e] starting ${IMAGE} as ${CONTAINER}`)
const startError = startGreenMail({ container: CONTAINER, ports: PORTS })
if (startError) fail(`could not start GreenMail:\n${startError}`)
if (!(await waitForImap(PORTS.imap))) {
  fail('GreenMail did not accept IMAP connections in time')
}
console.log(`[test:send-e2e] GreenMail ready on imap:${PORTS.imap} smtp:${PORTS.smtp}`)
console.log('[test:send-e2e] windows will appear briefly — that is expected\n')

let code = 1
try {
  buildHarness()
  code = await runHarness()
  if (code !== 0) {
    console.log('\n[test:send-e2e] GreenMail log (last 40 lines):')
    process.stdout.write(containerLogs(CONTAINER))
  }
} finally {
  cleanup()
  if (keep) console.log(`\n[test:send-e2e] container ${CONTAINER} left running (--keep)`)
}
process.exit(code)
