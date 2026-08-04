/**
 * The compose toolbar's font family and size, through a real editor.
 *
 * Run by `npm run test:e2e` (scripts/e2e.mjs). Needs a display; no mail server.
 *
 * Why a real window rather than a unit test of the handlers: `document.
 * execCommand` *is* the implementation. There is nothing underneath it to test —
 * the whole question is what Chromium's editing engine produces from a live
 * selection, and a stub that answered would only be describing the answer we
 * hoped for. Two specific things it produces that the code has to correct:
 *
 * - `fontName` emits `<font face="…">` unless styleWithCSS is on, and that flag
 *   is document-wide and sticky. If it were left on, **bold would stop emitting
 *   `<b>`** — so the suite sets a font and *then* checks bold still produces a
 *   `<b>`, which is the regression that mistake would cause.
 * - `fontSize` speaks only the legacy 1–7 scale, so the code tags with size 7
 *   and rewrites the result. Two ways that goes wrong and both are asserted: a
 *   `<font>` left behind in the message, and a `<font size="7">` that was
 *   already in pasted mail being resized along with the selection.
 *
 * The last check is the one with real consequences. The styling is inline
 * `style=`, and DOMPurify runs over the body **on every load** — so if it
 * stripped those declarations the toolbar would look like it worked and the
 * formatting would vanish the next time the draft was opened. The draft is
 * therefore saved, the composer closed, and the draft reopened.
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
// Deliberately awaits the predicate. Everything worth waiting for here is read
// out of a renderer, so a sync-only version would be handed a Promise — always
// truthy — and return true on the first tick, passing every later assertion
// against an editor that had not loaded yet.
const waitFor = async (what: () => boolean | Promise<boolean>, ms = 15_000) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await what()) return true
    await sleep(100)
  }
  return false
}

const uncaught: string[] = []
process.on('uncaughtException', (err) => {
  uncaught.push(String((err as Error)?.message ?? err))
})

const TYPED = 'format me'

async function main(): Promise<void> {
  app.setPath('userData', process.env.ORBIT_TEST_USERDATA ?? mkdtempSync(join(tmpdir(), 'orbit-fmt-e2e-')))
  await app.whenReady()
  await import('../electron/main')

  const started = await waitFor(() => BrowserWindow.getAllWindows().length > 0)
  ok('main.ts starts and opens its window', started)
  if (!started) return
  const mainWin = BrowserWindow.getAllWindows()[0]

  const db = await import('../electron/services/db-service')
  const drafts = await import('../electron/services/draft-service')
  const account = db.saveManualAccount('imap', {
    authType: 'password',
    email: 'fmt@example.com',
    displayName: 'Format E2E',
    username: 'rob',
    password: 'secret',
    incoming: { host: '127.0.0.1', port: 3243, security: 'none' },
    outgoing: { host: '127.0.0.1', port: 3225, security: 'none' }
  } as never)

  // Opened as a draft so there is a row to reopen from at the end. The body
  // carries a `<font size="7">` of the kind pasted mail contains, sitting
  // *outside* what gets selected: the size trick tags with size 7, so an
  // implementation that rewrites every match resizes this too.
  const subject = `E2E format ${process.pid}`
  const draftId = drafts.saveDraft({
    accountId: account.id,
    to: 'someone@example.com',
    subject,
    bodyText: `${TYPED} and pasted`,
    bodyHtml: `<p id="mine">${TYPED}</p><p><font size="7" id="pasted">pasted</font></p>`
  })

  await mainWin.webContents.executeJavaScript(
    `window.orbitMail.drafts.open(${JSON.stringify(draftId)})`, true
  )
  const opened = await waitFor(() => BrowserWindow.getAllWindows().length > 1)
  ok('the compose window opens', opened)
  if (!opened) return
  const composeWin = BrowserWindow.getAllWindows().find((w) => w !== mainWin)!
  if (composeWin.webContents.isLoading()) {
    await new Promise((r) => composeWin.webContents.once('did-finish-load', () => r(null)))
  }

  const EDITOR = `document.querySelector('.compose-editor-area [contenteditable]')`
  const readEditor = () => composeWin.webContents.executeJavaScript(
    `(() => {
       const editor = ${EDITOR}
       if (!editor) return { missing: true }
       return {
         html: editor.innerHTML,
         text: editor.innerText,
         fontTags: editor.querySelectorAll('font').length,
         pastedSize: editor.querySelector('#pasted')?.getAttribute('size') ?? null,
         pastedIsFont: editor.querySelector('#pasted')?.tagName ?? null,
         bolds: editor.querySelectorAll('b').length
       }
     })()`, true
  )

  // The draft has to have loaded before anything is selected, or the selection
  // is of an empty editor and every assertion below passes vacuously. This is
  // the trap the send suite hit twice.
  const loaded = await waitFor(async () => (await readEditor()).text?.includes(TYPED) === true, 10_000)
  const initial = await readEditor()
  ok('the composer loaded the draft body', initial.text?.includes(TYPED) === true,
    JSON.stringify(initial.text))
  if (!loaded) return
  ok('and the pasted <font size="7"> survived the load', initial.pastedSize === '7',
    `#pasted is <${initial.pastedIsFont} size=${initial.pastedSize}>`)

  // Select only the first paragraph — the point of the pasted one is that it is
  // outside the selection and must be left alone.
  const selectMine = () => composeWin.webContents.executeJavaScript(
    `(() => {
       const editor = ${EDITOR}
       editor.focus()
       const range = document.createRange()
       range.selectNodeContents(editor.querySelector('#mine'))
       const sel = getSelection()
       sel.removeAllRanges()
       sel.addRange(range)
       return sel.toString()
     })()`, true
  )
  ok('the text to format is selected', (await selectMine()) === TYPED)

  // Through the real controls, not by calling the handlers: `onMouseDown` saves
  // the selection and `onChange` applies it, and a test that skipped the events
  // would not notice if that pairing broke.
  const useSelect = (label: string, value: string) => composeWin.webContents.executeJavaScript(
    `(() => {
       const select = document.querySelector('.rte-toolbar select[aria-label="${label}"]')
       if (!select) return 'missing'
       select.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
       select.value = ${JSON.stringify(value)}
       select.dispatchEvent(new Event('change', { bubbles: true }))
       return select.value
     })()`, true
  )

  const sizeApplied = await useSelect('Font size', '24')
  await sleep(200)
  let state = await readEditor()
  ok('the size is applied as a CSS declaration', /font-size:\s*24px/i.test(state.html),
    state.html.slice(0, 220))
  // The marker tag is an implementation detail of getting there; shipping one in
  // the message is the failure it would be easy not to notice.
  ok('and no <font> marker is left in the message', state.fontTags === 1,
    `${state.fontTags} <font> tag(s) — 1 is the pasted one`)
  ok('the pasted <font size="7"> was not resized with it',
    state.pastedSize === '7' && !/id="pasted"[^>]*font-size/i.test(state.html),
    `#pasted is <${state.pastedIsFont} size=${state.pastedSize}>`)
  ok('the size select returns to its label', sizeApplied === '')

  // Straight after the size, with no reselection: rewriting the nodes collapses
  // the selection, so this only works because applyFontSize puts it back.
  const fontApplied = await useSelect('Font', 'Georgia, "Times New Roman", serif')
  await sleep(200)
  state = await readEditor()
  ok('a font applies to the same selection without reselecting it',
    /font-family:\s*Georgia/i.test(state.html), state.html.slice(0, 260))
  ok('as a CSS declaration, not a <font face> tag', !/<font[^>]*face=/i.test(state.html))
  ok('the font select returns to its label', fontApplied === '')

  // styleWithCSS is document-wide and sticky. Left on by the font command, this
  // is where it would show: bold would arrive as a styled span instead.
  await selectMine()
  await composeWin.webContents.executeJavaScript(
    `(() => { ${EDITOR}.focus(); document.execCommand('bold') })()`, true
  )
  await sleep(200)
  state = await readEditor()
  ok('styleWithCSS was turned back off — bold still emits <b>', state.bolds > 0,
    `${state.bolds} <b>, html: ${state.html.slice(0, 200)}`)

  // ---------------------------------------------------------------------------
  // The round trip. Inline styles are the fragile part: DOMPurify runs over the
  // body on every load, and a stripped declaration would look like a working
  // toolbar until the draft was reopened.
  // ---------------------------------------------------------------------------
  await composeWin.webContents.executeJavaScript(`window.__orbitMailFlushDraft?.()`, true)
  await sleep(500)
  const savedHtml = String(drafts.getDraftPayload(draftId)?.payload.bodyHtml ?? '')
  ok('the formatting reaches the saved draft',
    /font-size:\s*24px/i.test(savedHtml) && /font-family:\s*Georgia/i.test(savedHtml),
    savedHtml.slice(0, 220))

  composeWin.destroy()
  await waitFor(() => BrowserWindow.getAllWindows().length === 1)
  await mainWin.webContents.executeJavaScript(
    `window.orbitMail.drafts.open(${JSON.stringify(draftId)})`, true
  )
  const reopened = await waitFor(() => BrowserWindow.getAllWindows().length > 1)
  ok('the draft reopens', reopened)
  if (!reopened) return
  const secondWin = BrowserWindow.getAllWindows().find((w) => w !== mainWin)!
  if (secondWin.webContents.isLoading()) {
    await new Promise((r) => secondWin.webContents.once('did-finish-load', () => r(null)))
  }
  const readSecond = () => secondWin.webContents.executeJavaScript(
    `(() => {
       const editor = ${EDITOR}
       return { html: editor?.innerHTML ?? '', text: editor?.innerText ?? '' }
     })()`, true
  )
  await waitFor(async () => (await readSecond()).text.includes(TYPED), 10_000)

  const second = await readSecond()
  ok('and the sanitizer keeps the font and size on the way back in',
    /font-size:\s*24px/i.test(second.html) && /font-family:\s*Georgia/i.test(second.html),
    second.html.slice(0, 260))

  ok('nothing threw along the way', uncaught.length === 0, uncaught.join(' | ') || 'none')
  secondWin.destroy()
}

main()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`)
    app.exit(failed === 0 ? 0 : 1)
  })
  .catch((err) => {
    console.error('\n[e2e:format] harness error:', err)
    app.exit(1)
  })
