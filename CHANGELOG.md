# Changelog

What changed in each release, in plain language. For the reasoning behind a
change — including things deliberately *not* done — see [TODO.md](TODO.md),
which keeps decisions rather than just tasks.

Versions follow [semantic versioning](https://semver.org/). Before 1.0 the minor
number moves for anything substantial.

## 0.5.1 — 2026-07-30

Mostly fixes, including one that affected the 0.5.0 downloads themselves.

### AI (optional, and off unless you add your own key)

- **Choose which model to use, and how hard it thinks**, in Settings → AI.
  Previously both were fixed. A change applies to the next thing you ask for,
  not the next time you start the app.
- **Re-analyze all** re-runs the mailbox sweep over messages it has already read.
  Results are cached — an email does not change, so nothing re-reads a message on
  its own — which makes this the way to pick up a different model. It tells you
  how many messages it will send and asks before starting.

### Fixed

- **Sending no longer asks whether to save the message as a draft.** It had been
  asking about the message that had *just been sent*, and answering **Save draft**
  then said a draft had been filed when none existed. Sending now simply closes
  the window; closing it yourself still asks, as before.
- **Settings → AI: the "API key" label no longer runs into the row above it**, so
  it reads as its own field rather than part of the status line.

### Installing

- **Packaged files no longer have spaces in their names** — `orbit-mail-0.5.0-…`
  rather than `Orbit Mail-0.5.0-…`. The 0.5.0 downloads were affected: GitHub
  turns spaces into dots on upload, so the names on the release page matched
  neither the files nor the published checksums. The install commands in the
  README and INSTALL.md quoted the old name and found nothing; both are fixed.

## 0.5.0 — 2026-07-29

The first release since the initial version. A month of work: everything below
shipped under `0.1.0`, which never moved.

### Writing mail

- **Drafts save themselves as you type.** Closing the window asks whether to keep
  the draft. Saved drafts appear in **Drafts** in the sidebar — click to read
  one, double-click to carry on writing, Discard or press Delete to throw it
  away. Sending removes it. Drafts stay on this computer; they do not appear in
  webmail or on your phone.
- **Signatures**, per account, with formatting and an optional logo. Added to the
  end of what you write, above the quoted text on a reply.
- **Paste or drop an image straight into a message.** Images travel inside the
  message, so they appear in the recipient's client rather than arriving as a
  download.
- **To, Cc and Bcc autocomplete** from the people each account has actually
  corresponded with. No address book to maintain, and it works against the mail
  you already have. People you have written to are offered before people who
  merely wrote to you.
- **Forward** on the message itself, and forwarding now takes the original's
  attachments with it. If one cannot be fetched you are told which, rather than
  sending an incomplete forward silently.
- **Reply All**, and **Reply / Reply All / Forward** moved onto the message you
  are reading, where they act on something specific.
- **The quoted original can be edited or removed** — trim it to the part you are
  answering, or drop it entirely.
- A **rich formatting toolbar**: headings, bold, italic, underline, colour,
  lists, links, quotes, inline code. Drag-and-drop attachments.
- Compose now starts from **the account whose folder you are reading**, rather
  than always the first one.

### Reading and organising

- **Conversation threading**, with multi-select across conversations and bulk
  archive, move and delete.
- **Delete to Trash**, with the right destination per provider, and the
  selection moving to the next message rather than nowhere.
- **Search** across sender, recipient, subject and body, with a scope selector,
  and a server-side fallback that reaches mail outside your local sync window.
- **Blocking and muting a sender now do something.** Blocked mail is hidden from
  your lists, searches and unread counts — hidden, not deleted, and unblocking
  brings it straight back. Muting stops the notifications and leaves the mail
  alone.
- **Attachment save-as**, per attachment or all at once.
- **Mailbox export** to mbox.
- Sent folders list who the mail went *to*, rather than repeating your own name.

### Settings

- **A settings screen** (the gear, or `Ctrl` + `,`) with General, Accounts,
  Privacy and AI sections.
- **Accounts**: rename, choose how much mail to keep locally, see what an account
  is using, sync it, or remove it — and for IMAP/POP3 accounts, edit the server,
  port, security and password with a **Test connection** button.
- **Privacy**: the senders you have blocked or muted, with an undo for each, and
  whether remote images load everywhere or only for senders you allow.
- Choose whether closing the window keeps Orbit Mail running in the tray, whether
  new mail notifies you, and whether Orbit Mail handles `mailto:` links.

### AI (optional, and off unless you add your own key)

- **Draft reply** in your choice of tone, and now as a reply or a reply-all.
- **Analyze** a message into action items, questions and context, optionally
  including its attachments.
- **Tasks**: sweep a folder into one prioritised list. Re-running only looks at
  mail it has not seen, so it does not spend tokens twice. Print per account or
  export to Markdown.

### Living on your desktop

- **Unread count** on the tray icon and in the window title.
- **Closing the window keeps Orbit Mail running** in the tray, with mail still
  syncing. Quitting is deliberate.
- Desktop notifications for new mail.

### Privacy and security

- **Remote images are blocked by default** — loading one tells the sender you
  opened the mail, and when. Allow them per sender, per message, or everywhere.
- **Email content is treated as hostile input to the AI features.** Message text
  is fenced off in the prompt and the model is told to ignore instructions inside
  it. A mitigation, not a guarantee — read a draft before you send it.
- **Outgoing attachments are limited to files you chose**, so nothing can quietly
  attach something else from your disk.
- **Attachments that could execute** ask before opening, and name the real file
  extension.
- **Stored data is owner-only on disk** — the database, its sidecar files, and
  downloaded attachments — and installs from earlier versions are tightened in
  place.
- **Removing an account removes its data**: cached mail, attachments, saved
  tasks, collected addresses, drafts and stored credentials.

### Reliability

- Deleting, archiving or moving a message no longer has it reappear when a
  background refresh lands mid-flight.
- Server-side deletions are reconciled into the local cache, and flag changes are
  pushed over IMAP IDLE.
- POP3 identifies messages by their UIDL rather than a hash of it, so two
  messages can no longer collide; and it checks the sync window before
  downloading rather than after.
- Preferences are no longer lost when quitting immediately after a change.
- An unexpected error is now surfaced once rather than silently swallowed.
- Gmail deletions reach the Bin; Exchange accounts with grafted mailboxes pick
  the right Sent and Junk folders.
- mbox export is byte-faithful, including messages whose body contains a line
  starting `From `.

### Faster

- Message lists, conversation lists and folder switching are substantially
  quicker on real mailboxes: tuned SQLite settings, narrower queries, added
  indexes, batched sync writes, a virtualized list, optimistic UI, and a pooled
  IMAP connection per account.
- Search scans a stored plain-text copy of each message rather than raw HTML.

## 0.1.0 — 2026-06-28

Initial version: a three-pane Linux mail client with Gmail and Microsoft 365
sign-in, manual IMAP/POP3 accounts, local caching in SQLite, and compose and
send over SMTP.
