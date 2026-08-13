import type { Folder, MessageLabel, LabelChangeResult } from '../../shared/types'
import { isVirtualViewFolder } from '../../shared/folders'
import {
  deleteMessage,
  getAccountById,
  getFolderById,
  listFolders,
  listMessageCopies
} from './db-service'
import { copyMessageOnServer, deleteMessageOnServer } from './imap-sync'

// Which of an account's folders are offered as labels.
//
// Gmail's own system labels are folders here too, and most of them must not be
// on this list: `[Gmail]/All Mail` and friends are *views* (already excluded as
// virtual), and Sent, Drafts, Trash and Spam are places a message can only be
// put by moving it — offering "add the Trash label" would read as filing and
// behave as deleting. What is left is the Inbox and the user's own labels, and
// the Inbox belongs here deliberately: removing it is how Gmail archives.
//
// Nested labels come through as ordinary folders whose `imapPath` carries the
// hierarchy, so `Work/Receipts` is offered as its own label, which is what it
// is on the server.
export function labelFoldersForAccount(accountId: string): Folder[] {
  return listFolders(accountId).filter(
    (folder) =>
      !folder.isVirtualView &&
      (folder.type === 'inbox' || folder.type === 'custom')
  )
}

// Labels are an IMAP folder trick that only means "label" on Gmail. On any
// other account a message lives in exactly one folder, so a second copy is a
// second message, and calling that a label would be a lie about what the
// button did.
function assertGmail(accountId: string): { id: string } {
  const account = getAccountById(accountId)
  if (!account) throw new Error('Account not found')
  if (account.provider !== 'gmail') {
    throw new Error('Labels are a Gmail feature; this account stores messages in folders')
  }
  return account
}

/**
 * The labels carried by the given messages, and by how many of them.
 *
 * `messageCount` is what lets the caller tell "every message in this
 * conversation is labelled Work" from "one reply is" — a distinction Gmail
 * itself makes, and one that decides whether ticking the box adds a label or
 * completes a partial one.
 */
export function listMessageLabels(messageIds: string[]): MessageLabel[] {
  const copies = listMessageCopies(messageIds)
  if (copies.length === 0) return []

  const accountId = copies[0].accountId
  const labelFolders = new Map(
    labelFoldersForAccount(accountId).map((folder) => [folder.id, folder])
  )

  // Counted over *distinct* requested messages: a message with two copies in
  // one folder would otherwise report a count higher than the conversation
  // holds. That should not happen — (folder_id, uid) is unique — but the
  // arithmetic here decides a checkbox, and an impossible row should not be
  // able to tick it.
  const carriers = new Map<string, Set<string>>()
  for (const copy of copies) {
    if (!labelFolders.has(copy.folderId)) continue
    const seen = carriers.get(copy.folderId)
    if (seen) seen.add(copy.requestedId)
    else carriers.set(copy.folderId, new Set([copy.requestedId]))
  }

  return [...carriers]
    .map(([folderId, seen]) => {
      const folder = labelFolders.get(folderId)!
      return {
        folderId,
        name: folder.name,
        imapPath: folder.imapPath,
        isInbox: folder.type === 'inbox',
        messageCount: seen.size
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Put a label on every one of the given messages that does not already carry
 * it, by copying that message into the label's folder.
 *
 * The copy is taken from whichever folder already holds the message — any of
 * them will do, since they are the same message on the server, but a *virtual*
 * one will not: `[Gmail]/All Mail` is a view, and Gmail refuses a COPY out of
 * some of them. The source is therefore an ordinary folder when one exists.
 */
export async function addLabel(
  messageIds: string[],
  folderId: string
): Promise<LabelChangeResult> {
  const target = getFolderById(folderId)
  if (!target) throw new Error('That label no longer exists')
  const account = assertGmail(target.accountId)
  if (isVirtualViewFolder('gmail', target.imapPath)) {
    throw new Error(`${target.name} is a view, not a label`)
  }

  const copies = listMessageCopies(messageIds)
  let changed = 0
  let failed = 0

  for (const messageId of new Set(messageIds)) {
    const mine = copies.filter((c) => c.requestedId === messageId)
    if (mine.some((c) => c.folderId === folderId)) continue

    const source = mine.find((c) => {
      const folder = getFolderById(c.folderId)
      return folder != null && !folder.isVirtualView
    }) ?? mine[0]
    if (!source) {
      failed++
      continue
    }
    const sourceFolder = getFolderById(source.folderId)
    if (!sourceFolder) {
      failed++
      continue
    }

    try {
      await copyMessageOnServer(
        account.id,
        'gmail',
        sourceFolder.imapPath,
        target.imapPath,
        source.uid
      )
      changed++
    } catch {
      failed++
    }
  }

  return { changed, failed }
}

/**
 * Take a label off every one of the given messages that carries it, by
 * expunging that message's copy from the label's folder.
 *
 * On Gmail that removes the label and nothing else — the message survives in
 * All Mail even if this was its last label, which is what "archived, no
 * labels" already means there. The local row goes with it so the sidebar count
 * and the list do not have to wait for a sync to agree.
 */
export async function removeLabel(
  messageIds: string[],
  folderId: string
): Promise<LabelChangeResult> {
  const target = getFolderById(folderId)
  if (!target) throw new Error('That label no longer exists')
  const account = assertGmail(target.accountId)

  const copies = listMessageCopies(messageIds).filter((c) => c.folderId === folderId)
  let changed = 0
  let failed = 0

  for (const copy of copies) {
    try {
      await deleteMessageOnServer(account.id, 'gmail', target.imapPath, copy.uid, null)
      deleteMessage(copy.id)
      changed++
    } catch {
      failed++
    }
  }

  return { changed, failed }
}
