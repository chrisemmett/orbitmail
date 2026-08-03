/**
 * Zoom, through a real window and real keystrokes.
 *
 * Run by `npm run test:e2e` (scripts/e2e.mjs). Needs a display; no Docker — it
 * never talks to a mail server.
 *
 * The pure helpers in `electron/zoom.ts` are covered by `test:imap`, and they
 * are not the part that breaks. What breaks is the wiring: whether
 * `before-input-event` is actually registered, whether the key reaches it,
 * whether the level is applied to the window rather than only stored, and
 * whether it survives the reload that recovers a dead renderer. None of that is
 * reachable without a window — a windowless process has no `webContents` to
 * send a key to.
 *
 * `sendInputEvent` is used rather than a synthetic object, so what is under test
 * is the same path a keypress takes: Chromium delivers it, the handler sees the
 * `key` its layout produced, and the frame is zoomed for real.
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

const uncaught: string[] = []
process.on('uncaughtException', (err) => {
  const message = String((err as Error)?.message ?? err)
  uncaught.push(message)
  failed++
  console.log(`  FAIL  a callback threw — ${message}`)
})

/** One Ctrl+<key> press, as Chromium would deliver it. */
async function pressCtrl(window: BrowserWindow, key: string): Promise<void> {
  window.webContents.sendInputEvent({
    type: 'keyDown',
    keyCode: key,
    modifiers: ['control']
  })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: ['control'] })
  await sleep(150)
}

async function main(): Promise<void> {
  app.setPath('userData', process.env.ORBIT_TEST_USERDATA ?? mkdtempSync(join(tmpdir(), 'orbit-e2e-')))
  await app.whenReady()
  await import('../electron/main')

  const started = await waitFor(() => BrowserWindow.getAllWindows().length > 0)
  ok('main.ts starts and opens its window', started)
  if (!started) return
  const mainWin = BrowserWindow.getAllWindows()[0]
  await waitFor(() => !mainWin.webContents.isLoading())

  ok('a fresh profile opens at 100%', mainWin.webContents.getZoomLevel() === 0,
    `${mainWin.webContents.getZoomLevel()}`)

  await pressCtrl(mainWin, '=')
  ok('Ctrl and the unshifted plus key zooms in',
    mainWin.webContents.getZoomLevel() === 1, `${mainWin.webContents.getZoomLevel()}`)

  // The reported case. On this layout Ctrl and the `-` key can arrive as `_`,
  // which is why the default menu's `CommandOrControl+-` accelerator missed it.
  await pressCtrl(mainWin, '_')
  ok('Ctrl and the underscore some layouts send zooms back out',
    mainWin.webContents.getZoomLevel() === 0, `${mainWin.webContents.getZoomLevel()}`)

  await pressCtrl(mainWin, '-')
  ok('and so does a plain minus',
    mainWin.webContents.getZoomLevel() === -1, `${mainWin.webContents.getZoomLevel()}`)

  await pressCtrl(mainWin, '0')
  ok('Ctrl and zero returns to 100%',
    mainWin.webContents.getZoomLevel() === 0, `${mainWin.webContents.getZoomLevel()}`)

  // Persisted, not just applied — the setting has to survive a restart.
  await pressCtrl(mainWin, '=')
  await pressCtrl(mainWin, '=')
  const prefs = await import('../electron/services/preferences-service')
  ok('the level is written to preferences', prefs.getZoomLevel() === 2, `${prefs.getZoomLevel()}`)

  // A zoom level belongs to the loaded frame, so a reload resets it to 100%.
  // That includes the reload used to recover from a dead renderer, which would
  // otherwise silently undo the user's setting at the worst moment.
  mainWin.webContents.reload()
  await waitFor(() => !mainWin.webContents.isLoading())
  await sleep(300)
  ok('and survives the reload that recovers a crashed renderer',
    mainWin.webContents.getZoomLevel() === 2, `${mainWin.webContents.getZoomLevel()}`)

  // A composer opened afterwards must match, not open at 100%: two windows at
  // different sizes reads as a bug rather than a feature.
  await mainWin.webContents.executeJavaScript(`window.orbitMail.compose.open({})`, true)
  const opened = await waitFor(() => BrowserWindow.getAllWindows().length > 1)
  ok('a compose window is open', opened)
  if (opened) {
    const composeWin = BrowserWindow.getAllWindows().find((w) => w !== mainWin)!
    await waitFor(() => !composeWin.webContents.isLoading())
    await sleep(300)
    ok('a new composer opens at the same zoom as the window it came from',
      composeWin.webContents.getZoomLevel() === 2, `${composeWin.webContents.getZoomLevel()}`)

    // And zooming from either window moves both.
    await pressCtrl(composeWin, '0')
    ok('zooming from the composer moves the main window too',
      mainWin.webContents.getZoomLevel() === 0 && composeWin.webContents.getZoomLevel() === 0,
      `main ${mainWin.webContents.getZoomLevel()}, compose ${composeWin.webContents.getZoomLevel()}`)
    composeWin.destroy()
  }

  await sleep(300)
  if (uncaught.length === 0) ok('nothing threw along the way', true, 'none')
}

main()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`)
    app.exit(failed === 0 ? 0 : 1)
  })
  .catch((err) => {
    console.error('\n[e2e:zoom] harness error:', err)
    app.exit(1)
  })
