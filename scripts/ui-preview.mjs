// Serve the built renderer to an ordinary browser, with `window.orbitMail` stubbed.
//
//   npm run build && npm run ui:preview     # then open http://localhost:4321
//
// Why this exists: `npm run dev` cannot start here (GPU sandbox crash), so every
// UI change used to end with "someone please click through it". The renderer is
// a plain React app — the only reason it will not run outside Electron is that
// it errors on a missing IPC bridge. Stubbing that bridge is the same trick
// `scripts/store-race.mjs` uses to reach renderer logic under node; this does it
// in a real DOM so the result can be looked at, screenshotted, and driven by
// browser automation.
//
// WHAT THIS PROVES: layout, styling, both themes, whether a control renders and
// reacts, and that the renderer mounts without console errors.
//
// WHAT IT DOES NOT: anything main-process. Every IPC answer here is a fixture,
// so a pane can look perfect while the channel behind it is missing. The IPC
// contract check and the behaviour tests in `npm run test:imap` are what cover
// that, and neither is replaced by this.

import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RENDERER_DIR = process.env.RENDERER_DIR ?? join(REPO_ROOT, 'out', 'renderer')
const PORT = Number(process.env.PORT ?? 4321)

if (!existsSync(join(RENDERER_DIR, 'index.html'))) {
  console.error(`No built renderer at ${RENDERER_DIR} — run \`npm run build\` first.`)
  process.exit(1)
}

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

// The stub, as a source string — it is served as its own file rather than
// inlined because the production CSP is `script-src 'self'`.
//
// Fixtures are deliberately a little messy (two accounts, unread counts, a
// muted and a blocked sender, a swept task list): a pane that only ever renders
// empty state hides most of what is worth looking at.
const STUB = `
const accounts = [
  { id: 'acc-1', email: 'you@example.com', displayName: 'Personal', provider: 'imap', syncDays: 30, signature: '' },
  { id: 'acc-2', email: 'you@work.example', displayName: 'Work', provider: 'gmail', syncDays: 90, signature: '' }
]
const folders = accounts.flatMap((a) => [
  { id: a.id + '-inbox', accountId: a.id, name: 'Inbox', type: 'inbox', unreadCount: 3, totalCount: 12 },
  { id: a.id + '-sent', accountId: a.id, name: 'Sent', type: 'sent', unreadCount: 0, totalCount: 8 },
  { id: a.id + '-drafts', accountId: a.id, name: 'Drafts', type: 'drafts', unreadCount: 0, totalCount: 0 }
])

// Where a caller needs a particular shape. Anything not listed falls through to
// the generic rule below.
const OVERRIDES = {
  'accounts.list': accounts,
  // Must carry every field of AccountInfo. A fixture missing one does not
  // degrade — the pane throws on it (\`info.unreadCount.toLocaleString()\`), and
  // the crash looks exactly like an app bug until you read the stack. If a pane
  // blows up here, suspect the fixture before the component.
  'accounts.getInfo': {
    id: 'acc-1', provider: 'imap', providerLabel: 'IMAP',
    email: 'you@example.com', displayName: 'Personal',
    createdAt: Date.now() - 86400000 * 200,
    folderCount: 9, messageCount: 1284, unreadCount: 3,
    syncDays: 30, localStorageBytes: 41233920,
    attachmentCount: 212, downloadedAttachmentCount: 64,
    signature: ''
  },
  // ManualAccountSettings — nested \`incoming\`/\`outgoing\`, and note there is no
  // \`password\` field: main never sends one (see toManualSettings), so the
  // fixture must not invent one either.
  'accounts.getManualSettings': {
    email: 'you@example.com',
    displayName: 'Personal',
    username: 'you@example.com',
    incomingProtocol: 'imap',
    incoming: { host: 'imap.example.com', port: 993, security: 'ssl' },
    outgoing: { host: 'smtp.example.com', port: 465, security: 'ssl' },
    hasPassword: true
  },
  'folders.list': folders,
  'messages.list': [],
  'messages.count': 0,
  'messages.listThreads': [],
  'messages.countThreads': 0,
  'sync.getStatus': { syncing: false, lastSyncAt: Date.now() - 120000, error: null, syncCurrent: 0, syncTotal: 0 },
  'ai.getStatus': { configured: true },
  'ai.getTasks': {
    tasks: [
      { id: 't1', task: 'Send the signed lease back to the letting agent', priority: 'urgent',
        sourceMessageId: 'm1', sourceSubject: 'Lease renewal — action needed',
        sourceFrom: 'Lettings <lettings@example.com>' },
      { id: 't2', task: 'Confirm numbers for the quiz night', priority: 'medium',
        sourceMessageId: 'm2', sourceSubject: 'Quiz night headcount',
        sourceFrom: 'Jan <jan@work.example>' }
    ],
    completed: [],
    analyzedCount: 34,
    scope: 'unread',
    sweptAt: Date.now() - 3600000
  },
  'app.getSecureStorageStatus': { available: true },
  'app.getPlatformCapabilities': { trayActive: true, notificationsSupported: true, mailtoHandlerActive: false },
  'drafts.list': [],
  'contacts.suggest': [],
  'preferences.get': {
    ui: {
      darkMode: false, selectedFolderId: 'acc-1-inbox', selectedMessageId: null,
      collapsedAccountIds: {}, favoriteFolderIds: [], threadedView: true,
      unreadFilterByAccount: {}, searchField: 'all'
    },
    lastSyncAt: Date.now() - 120000,
    handleMailtoLinks: false, closeToTray: true, desktopNotifications: true,
    alwaysLoadRemoteImages: false,
    mutedSenders: ['newsletter@example.com'],
    blockedSenders: ['spam@example.com'],
    imageAllowedSenders: ['receipts@example.com']
  }
}

// A name that reads like a list returns one, a save echoes what it was given,
// everything else resolves null. Guessing wrong surfaces as a console error or
// an obviously empty pane rather than as something that looks true and is not.
function fallback(method, args) {
  if (/^(list|search|suggest)/.test(method)) return []
  if (/^count/.test(method)) return 0
  if (/^(save|update|set|patch)/.test(method)) return args[0] ?? null
  return null
}

window.orbitMail = new Proxy({}, {
  get: (_t, ns) => new Proxy({}, {
    get: (_t2, method) => {
      if (typeof method !== 'string') return undefined
      // Event subscribers are synchronous and hand back an unsubscribe.
      if (/^on[A-Z]/.test(method)) return () => () => {}
      const key = ns + '.' + method
      return (...args) => {
        const value = key in OVERRIDES ? OVERRIDES[key] : fallback(method, args)
        console.debug('[stub]', key, args, '->', value)
        return Promise.resolve(structuredClone(value))
      }
    }
  })
})
console.info('[ui-preview] window.orbitMail is a stub. Nothing here talks to a mail server.')
`

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')

  if (url.pathname === '/orbit-stub.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' }).end(STUB)
    return
  }

  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
  const file = join(RENDERER_DIR, normalize(rel).replace(/^(\.\.[/\\])+/, ''))
  if (!existsSync(file)) {
    res.writeHead(404).end('not found')
    return
  }

  let body = readFileSync(file)
  if (rel === 'index.html') {
    body = Buffer.from(
      body
        .toString()
        // The stub has to be installed before the app bundle runs.
        .replace(
          '<script type="module"',
          '<script src="./orbit-stub.js"></script>\n    <script type="module"'
        )
        // Google Fonts is the only off-origin fetch the page makes, and waiting
        // on it just slows the preview down.
        .replace(/<link rel="(preconnect|stylesheet)"[^>]*fonts\.(googleapis|gstatic)[^>]*>/g, '')
    )
  }

  res
    .writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    .end(body)
}).listen(PORT, () => {
  console.log(`ui-preview serving ${RENDERER_DIR} on http://localhost:${PORT}`)
  console.log('Ctrl+C to stop. Rebuild (npm run build) to pick up changes.')
})
