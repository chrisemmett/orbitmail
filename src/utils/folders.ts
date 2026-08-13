import type { Folder, FolderType } from '../../shared/types'

export function findAccountFolder(
  folders: Folder[],
  accountId: string,
  type: FolderType
): Folder | undefined {
  return folders.find((f) => f.accountId === accountId && f.type === type)
}

// The part of an IMAP path above the folder itself — `Work` for `Work/Receipts`,
// `[Gmail]` for `[Gmail]/All Mail`. The delimiter is per-server (`/` on Gmail,
// `.` on others) and nothing stores it, but it does not need to be known: the
// folder's name is the tail of its own path, so whatever single character sits
// in front of it is the delimiter.
//
// Undefined for a top-level folder, and for anything whose name is *not* the
// tail of its path — a renamed or localized name, a virtual view — because a
// guess at the parent there would be worse than saying nothing.
export function folderParentPath(folder: Folder): string | undefined {
  const { imapPath, name } = folder
  if (!name || !imapPath.endsWith(name)) return undefined
  // A top-level folder is its own path. Without this the slice below runs off
  // the front — `slice(0, -1)` of "Receipts" is "Receipt", a parent that does
  // not exist, spelled almost like the folder it was cut from.
  if (imapPath.length <= name.length + 1) return undefined
  return imapPath.slice(0, imapPath.length - name.length - 1) || undefined
}

// Which favourite rows cannot be told apart by name alone, and what to add to
// them. Favourites is the one list that mixes accounts *and* shows a folder's
// name without its path, so a name can collide two ways, and the two need
// different answers:
//
//   - pinned by more than one account → the account name
//   - pinned twice within one account → the parent path, since the account name
//     would be identical on both rows and would look like an answer
//
// Both can be true at once (two accounts, one of which pinned the name twice),
// which is why this returns the parts joined rather than picking one. Rows whose
// name is unique are absent from the map: qualifying them would repeat a word
// down a list where the answer is already obvious.
//
// Names are compared case-insensitively — `receipts` and `Receipts` are as
// confusable as two exact matches.
export function favoriteRowHints(
  folders: Folder[],
  accountNames: Map<string, string>
): Map<string, string> {
  const byName = new Map<string, Folder[]>()
  for (const folder of folders) {
    const key = folder.name.toLocaleLowerCase()
    const group = byName.get(key)
    if (group) group.push(folder)
    else byName.set(key, [folder])
  }

  const hints = new Map<string, string>()
  for (const group of byName.values()) {
    if (group.length < 2) continue
    const spansAccounts = group.some((f) => f.accountId !== group[0].accountId)

    for (const folder of group) {
      const parts: string[] = []
      if (spansAccounts) {
        const accountName = accountNames.get(folder.accountId)
        if (accountName) parts.push(accountName)
      }
      const repeatsWithinAccount =
        group.filter((f) => f.accountId === folder.accountId).length > 1
      if (repeatsWithinAccount) {
        const parent = folderParentPath(folder)
        if (parent) parts.push(parent)
      }
      if (parts.length > 0) hints.set(folder.id, parts.join(' · '))
    }
  }
  return hints
}

export function findArchiveFolder(
  folders: Folder[],
  accountId: string
): Folder | undefined {
  const accountFolders = folders.filter((f) => f.accountId === accountId)
  return accountFolders.find(
    (f) =>
      /archive|all mail/i.test(f.name) ||
      /archive|\[Gmail\]\/All Mail/i.test(f.imapPath)
  )
}
