/**
 * Window lifecycle: nothing may use a window after it has gone.
 *
 * Run by `npm run test:e2e` (scripts/e2e.mjs). Needs a display; no Docker — it
 * never talks to a mail server.
 *
 * `mainWindow?.` guards against *null*, and a destroyed BrowserWindow is not
 * null, so the optional chain passes and the call throws "Object has been
 * destroyed". A compose window is created with `parent: mainWindow`, so closing
 * the main window destroys the composer too, and the composer's own `closed`
 * handler calls notifyMessagesUpdated() — badge, title, and a send to the
 * renderer, all aimed at the window that has just gone.
 *
 * Two things this proved the hard way, and the reason it is a real check rather
 * than an isDestroyed() spot-fix:
 *
 * - Nulling `mainWindow` in its own `closed` handler does **not** fix it. The
 *   child's `closed` runs *first*, so the reference is still the destroyed
 *   window when the composer's handler fires.
 * - Checking `window.isDestroyed()` alone does **not** either. The webContents is
 *   destroyed *before* the window reports itself destroyed, so `webContents.send`
 *   still threw. `liveMainWindow()` checks both, and that is what this pins.
 */
import { app, BrowserWindow } from 'electron'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

app.disableHardwareAcceleration()

let passed = 0
let failed = 0
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) passed++
  else failed++
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (what: () => boolean, ms = 15_000) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (what()) return true
    await sleep(100)
  }
  return false
}

// main.ts installs its own uncaughtException handler, so a throw in a window
// callback does not stop the process — it just goes to the log. This is the whole
// assertion, so it is recorded here.
//
// Reported *immediately* rather than at the end, because the regression this
// exists to catch does not leave a tidy path to the end: the throw derails the
// close it happened in, and the process goes down with a second one before any
// summary can print. Without this line a failure read as three passes and a
// stack trace.
const uncaught: string[] = []
process.on('uncaughtException', (err) => {
  const message = String((err as Error)?.message ?? err)
  uncaught.push(message)
  failed++
  console.log(`  FAIL  a window or sync callback threw — ${message}`)
})

async function main(): Promise<void> {
  app.setPath('userData', process.env.ORBIT_TEST_USERDATA ?? mkdtempSync(join(tmpdir(), 'orbit-e2e-')))
  await app.whenReady()
  await import('../electron/main')

  const started = await waitFor(() => BrowserWindow.getAllWindows().length > 0)
  ok('main.ts starts and opens its window', started)
  if (!started) return
  const mainWin = BrowserWindow.getAllWindows()[0]

  // Close-to-tray is on by default and *hides* the window, in which case it is
  // never destroyed and the state under test cannot arise — which is exactly why
  // this went unnoticed. Turning it off is a real setting, and also how the app
  // behaves on a desktop with no tray at all.
  const prefs = await import('../electron/services/preferences-service')
  prefs.patchAppState({ closeToTray: false })

  // Opened through the real channel, so it is a genuine child of the main window.
  await mainWin.webContents.executeJavaScript(`window.orbitMail.compose.open({})`, true)
  const opened = await waitFor(() => BrowserWindow.getAllWindows().length > 1)
  ok('a compose window is open', opened)
  if (!opened) return
  const composeWin = BrowserWindow.getAllWindows().find((w) => w !== mainWin)!
  ok('the composer is a child of the main window', composeWin.getParentWindow() === mainWin)

  // Destroying every window would fire window-all-closed and quit the app before
  // anything could be asserted. This one belongs to the harness, is not a child
  // of the main window, and takes no part in what is being tested.
  const keepAlive = new BrowserWindow({ show: false })

  let composeClosed = false
  composeWin.on('closed', () => { composeClosed = true })
  uncaught.length = 0

  // The user action: close the main window while a composer is open.
  mainWin.close()
  const gone = await waitFor(() => mainWin.isDestroyed())
  ok('the main window is really destroyed, not hidden to a tray', gone,
    gone ? '' : 'still alive — closeToTray took the close, so this proved nothing')
  if (!gone) return
  ok('the composer is destroyed with its parent', await waitFor(() => composeClosed))

  // The composer's `closed` handler has now run notifyMessagesUpdated() against
  // a main window that no longer exists. Anything it threw has already been
  // reported by the handler above, so only the clean case is announced here.
  await sleep(500)
  if (uncaught.length === 0) {
    ok('closing the main window with a composer open throws nothing', true, 'none')
  }

  keepAlive.destroy()
}

main()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`)
    app.exit(failed === 0 ? 0 : 1)
  })
  .catch((err) => {
    console.error('\n[e2e:window] harness error:', err)
    app.exit(1)
  })
