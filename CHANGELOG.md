# Changelog

What changed in each release, in plain language. For the reasoning behind a
change — including things deliberately *not* done — see [TODO.md](TODO.md),
which keeps decisions rather than just tasks.

Versions follow [semantic versioning](https://semver.org/). Before 1.0 the minor
number moves for anything substantial.

## Unreleased

### Added

- **An email forwarded to you as an attachment can now be summarised.** Analyze
  reads the attached message — who it was from, when, and what it says — rather
  than noting that a `.eml` arrived. If that message carried attachments of its
  own they are named but not opened.

## 0.6.0 — 2026-08-03

The AI features get a lot more useful, and there is a zoom. Attachments are now
read rather than merely noticed — a meeting agenda is summarised, not pointed
at — and every action says who owes it, so you can see what is yours at a
glance. Summaries say more by default, with a Brief setting if you preferred the
shorter kind. Plus the shortcuts every browser has for making the text bigger.

### Added

- **Zoom.** `Ctrl` and `+` or `-` makes everything bigger or smaller, `Ctrl` `0`
  puts it back — the same keys a browser uses. It applies to every window and is
  remembered between runs.
- **The AI features can now read attachments properly.** Word, Excel,
  PowerPoint, OpenDocument and RTF files, plus calendar invitations and contact
  cards, are read and summarised alongside the message. Formats it still cannot
  read — older `.doc` and `.xls`, Apple iWork files, password-protected
  documents — are named under the summary instead of being quietly left out.
- **Action items say who owes them.** Yours are marked and listed first, so you
  can see at a glance what is on you and what you are waiting on someone else
  for. Previously the list showed only your own actions, which meant an empty
  list could equally mean "nothing for you" or "nothing found".
- **A Brief / Full setting for summaries**, in Settings → AI. Brief is a
  sentence or two and only what you need to act on, and costs less per message.

### Changed

- **Summaries say more by default** — a short paragraph rather than a sentence
  or two, carrying the dates, amounts and names rather than alluding to them.
  Set Detail to Brief in Settings → AI if you preferred the shorter kind.

### Fixed

- **A blank window is recoverable.** If the window ever goes white, a panel now
  offers **Reload** instead of leaving you to quit and reopen, and what went
  wrong is written to `renderer-errors.log` in your settings folder — which is
  the useful thing to attach if you report it.
- **Buttons and menu items now respond when you hover them.** Several controls —
  the formatting buttons in the composer, the account menu, the status bar
  actions — were meant to highlight under the pointer and never did. Attachment
  chips and inline code in a message also get the background they were supposed
  to have, and the account menu its shadow.

## 0.5.4 — 2026-07-31

Three fixes to things you would have noticed while using it: dark mode, and
being told about the same email twice.

### Fixed

- **Dark mode no longer shows unreadable email text.** Messages written for a
  white page — black text on no background, or text sitting on the sender's own
  white table — came out near-invisible against the dark theme. Those messages
  now render on a light card, the way the sender intended, while the rest of the
  app stays dark. Mail that sets no colours of its own, or that brings its own
  dark styling, is unchanged. The quoted original when you reply gets the
  same treatment, so a reply is readable while you write it.
- **The composer's formatting toolbar is no longer a white bar in dark mode**,
  and neither is the panel shown when you drag a file onto a message.
- **New mail no longer notifies you twice.** A message that arrived while the app
  was watching for push could also be picked up by the periodic check a moment
  later, and each announced it. They now agree on which message they are talking
  about, so one email is one notification.

## 0.5.3 — 2026-07-31

A single fix, shipped on its own because of what it touches: on very long
conversations, replies were going to the wrong people.

### Fixed

- **Replying to a very long conversation now replies to the latest message.** On
  a thread of more than a couple of hundred messages the reader was showing the
  oldest part of it, and Reply, Reply All, Forward and Draft reply all acted on a
  message from the middle — so the reply threaded oddly for everyone else, and
  Reply All could go to the people who were on the conversation back then rather
  than the people on it now. Gmail accounts hit this sooner, because a message
  filed under several labels counted several times.

## 0.5.2 — 2026-07-31

The one to take if you use a POP3 account: they were not syncing at all in
0.5.0 or 0.5.1. Also adds conversation summaries, and fixes a reply-drafting
fault that affected long threads.

### AI (optional, and off unless you add your own key)

- **Summarize a conversation, not just a message.** A new button on any
  conversation turns the whole thread into what it is about, what was decided,
  what is still outstanding and who owes it, and what nobody has answered.
  Summaries are kept, so reopening a thread costs nothing; when new mail arrives
  the summary is shown with a note saying how far behind it is, rather than
  quietly re-running and spending on your key. Long threads say plainly how much
  of the conversation the summary covers.

### Fixed

- **Draft reply now reads the end of a long conversation.** On a thread longer
  than a dozen messages it was given the *oldest* twelve — so on exactly the
  conversations where help matters most, it drafted a reply without having seen
  the message it was replying to. It also missed a conversation of one message
  entirely, and on Gmail counted the same email once per label.

- **POP3 accounts were not syncing at all.** A fault introduced on 23 July — and
  present in both 0.5.0 and 0.5.1 — made every POP3 poll fail immediately, so no
  new mail arrived for those accounts and the unread count never moved. IMAP,
  Gmail and Office 365 accounts were unaffected. If you use a POP3 account, this
  is the release to update to.
- **Clicking something after a pause is quicker.** The connection to your mail
  server is now kept for five minutes rather than thirty seconds, so marking,
  moving or deleting mail after a short break no longer waits for a fresh login
  first. If the connection has quietly died in the meantime — which happens on
  home routers and hotel wifi — it is now detected and replaced instead of the
  action failing.
- **POP3 polls no longer re-read old messages.** Mail older than the sync window
  is not kept, but every poll — every twenty seconds — was still asking the server
  for its headers. It is now remembered as too old and left alone, so a mailbox
  with a lot of old mail costs far less network and battery. Widening **Keep mail
  for** in Settings → Accounts still brings that mail back.

### Writing mail

- **Changing the From account now swaps the signature.** Previously it was chosen
  when the composer opened and stayed put, so a message sent from a second account
  went out with the first account's sign-off. What you have typed is left alone;
  switching to an account with no signature removes the block. A signature you
  have edited in the composer is replaced along with the rest of it.

- **The copy of a sent message in Sent now shows who you blind-copied.** Bcc is
  still kept out of what is actually sent — putting it there would tell every
  other recipient who was blind-copied — but your own filed copy records it, the
  way other mail clients do. Applies to IMAP accounts, where Orbit Mail files the
  Sent copy itself; Gmail files its own.

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
