/**
 * The signature follows the From account.
 *
 * Run by `npm run test:e2e` (scripts/e2e.mjs). Needs a display; no mail server —
 * nothing here sends.
 *
 * This is an end-to-end check because the mechanism only exists end to end: main
 * appends the signature wrapped in `SIGNATURE_CLASS`, the marker has to survive
 * DOMPurify inside the renderer, and the composer then finds that node and
 * replaces it *in the live DOM* — the body editor is uncontrolled, so a re-render
 * would mean remounting it and discarding whatever had been typed. A unit test of
 * any one of those three would pass while the feature was broken.
 *
 * The case that matters most is the one in the middle: if the sanitizer stripped
 * `class`, the marker would be gone by the time the composer looked for it, and
 * switching accounts would silently *append* a second signature rather than
 * replace the first.
 */
import { app, BrowserWindow } from 'electron'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SIGNATURE_CLASS } from '../shared/signature'

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

const TYPED = 'Text the user typed'

async function main(): Promise<void> {
  app.setPath('userData', process.env.ORBIT_TEST_USERDATA ?? mkdtempSync(join(tmpdir(), 'orbit-e2e-')))
  await app.whenReady()
  await import('../electron/main')

  const started = await waitFor(() => BrowserWindow.getAllWindows().length > 0)
  ok('main.ts starts and opens its window', started)
  if (!started) return
  const mainWin = BrowserWindow.getAllWindows()[0]

  const db = await import('../electron/services/db-service')
  const account = (email: string) =>
    db.saveManualAccount('imap', {
      authType: 'password',
      email,
      displayName: email,
      username: 'rob',
      password: 'secret',
      incoming: { host: '127.0.0.1', port: 3243, security: 'none' },
      outgoing: { host: '127.0.0.1', port: 3225, security: 'none' }
    } as never)

  // Three accounts, because the third case — an account with *no* signature — is
  // the one that has to remove the block rather than leave the previous one.
  const alice = account('alice@example.com')
  const bob = account('bob@example.com')
  const noSig = account('nosig@example.com')
  db.setAccountSignature(alice.id, '<p>Alice, Example Ltd</p>')
  db.setAccountSignature(bob.id, '<p>Bob, Example Ltd</p>')

  await mainWin.webContents.executeJavaScript(
    `window.orbitMail.compose.open(${JSON.stringify({ accountId: alice.id })})`, true
  )
  const opened = await waitFor(() => BrowserWindow.getAllWindows().length > 1)
  ok('the compose window opens', opened)
  if (!opened) return
  const composeWin = BrowserWindow.getAllWindows().find((w) => w !== mainWin)!
  if (composeWin.webContents.isLoading()) {
    await new Promise((r) => composeWin.webContents.once('did-finish-load', () => r(null)))
  }

  const readEditor = () => composeWin.webContents.executeJavaScript(
    `(() => {
       const editor = document.querySelector('.compose-editor-area [contenteditable]')
       if (!editor) return { missing: true }
       return {
         text: editor.innerText,
         html: editor.innerHTML,
         markers: editor.querySelectorAll('.${SIGNATURE_CLASS}').length,
         insideBlock: editor.querySelector('.${SIGNATURE_CLASS}')?.innerText ?? '',
         // Blank lines are how the earlier version of this leaked: the block was
         // removed but the <br><br> before it was not, and appending added
         // another pair, so switching From repeatedly grew a stack of them.
         brs: editor.querySelectorAll('br').length
       }
     })()`, true
  )
  const settle = async (predicate: (state: { text: string }) => boolean) => {
    let state = await readEditor()
    for (let i = 0; i < 50 && !(state.missing === undefined && predicate(state)); i++) {
      await sleep(100)
      state = await readEditor()
    }
    return state
  }

  let state = await settle((s) => s.text.includes('Alice'))
  ok("the composer opens with the From account's signature",
    state.text.includes('Alice'), JSON.stringify(state.text))
  const separatorBrs = state.brs

  // The linchpin: if DOMPurify dropped `class`, the marker is gone here and the
  // swap below would append instead of replacing.
  ok('the signature marker survives the renderer sanitizer', state.markers === 1,
    `${state.markers} marker(s)`)

  // Type into the body the way a user would, so the swap has something of theirs
  // to preserve — the whole reason this edits the DOM instead of re-rendering.
  await composeWin.webContents.executeJavaScript(
    `document.querySelector('.compose-editor-area [contenteditable]').focus()`, true
  )
  composeWin.webContents.insertText(TYPED)
  state = await settle((s) => s.text.includes(TYPED))
  ok('typing lands in the body', state.text.includes(TYPED), JSON.stringify(state.text))
  // Where it lands is the whole ballgame. On a new message the body is otherwise
  // empty, so if the signature block were the editor's first child the caret
  // would open *inside* it — the user would type into their signature, and the
  // next From switch would replace the block and delete the message with it. That
  // is not hypothetical: an earlier version of this change did exactly that, and
  // this assertion is why it did not ship.
  ok('and outside the signature block, not into it',
    !state.insideBlock.includes(TYPED), `block holds ${JSON.stringify(state.insideBlock)}`)

  const chooseFrom = (accountId: string) => composeWin.webContents.executeJavaScript(
    `(() => {
       const select = document.querySelector('.compose-field select.compose-input')
       select.value = ${JSON.stringify(accountId)}
       select.dispatchEvent(new Event('change', { bubbles: true }))
       return select.value
     })()`, true
  )

  await chooseFrom(bob.id)
  state = await settle((s) => s.text.includes('Bob'))
  ok('changing the From account swaps the signature',
    state.text.includes('Bob') && !state.text.includes('Alice'), JSON.stringify(state.text))
  ok('and does not leave a second one behind', state.markers === 1, `${state.markers} marker(s)`)
  ok('and keeps what the user had typed', state.text.includes(TYPED), JSON.stringify(state.text))

  await chooseFrom(noSig.id)
  state = await settle((s) => !s.text.includes('Bob'))
  ok('an account with no signature removes the block',
    state.markers === 0 && !state.text.includes('Bob'),
    `${state.markers} marker(s): ${JSON.stringify(state.text)}`)
  ok('the typed text still survives that', state.text.includes(TYPED), JSON.stringify(state.text))
  ok('and the blank line goes with the block, not left behind',
    state.brs === 0, `${state.brs} <br>(s) remain`)

  // Back to one that has a signature: there is no block left to replace, so this
  // is the append path rather than the swap path.
  await chooseFrom(alice.id)
  state = await settle((s) => s.text.includes('Alice'))
  ok('switching back to an account with a signature adds one again',
    state.markers === 1 && state.text.includes('Alice'),
    `${state.markers} marker(s): ${JSON.stringify(state.text)}`)
  // Four switches in, the body must look exactly as it did after one — no stack
  // of blank lines from the removals and re-appends.
  ok('and switching From repeatedly does not accumulate blank lines',
    state.brs === separatorBrs, `${state.brs} <br>(s), opened with ${separatorBrs}`)

  await sleep(300)
  if (uncaught.length === 0) ok('nothing threw along the way', true, 'none')
}

main()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`)
    app.exit(failed === 0 ? 0 : 1)
  })
  .catch((err) => {
    console.error('\n[e2e:signature] harness error:', err)
    app.exit(1)
  })
