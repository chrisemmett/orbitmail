import type { Account } from '../../shared/types'

// The short form of an account's name, for places too narrow for the address:
// a context-menu item, a qualifier on a sidebar row. `displayName` can be blank
// or whitespace, in which case the address is the only thing left to show.
export function accountShortName(account: Account): string {
  return account.displayName.trim() || account.email
}
