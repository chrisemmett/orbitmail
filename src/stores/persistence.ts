import type { UiPreferences } from '../../shared/types'
import { resolveAiDetail, resolveAiEffort, resolveAiModel } from '../../shared/ai-models'
import { useThemeStore } from './themeStore'
import { useMailStore } from './mailStore'

let saveTimer: ReturnType<typeof setTimeout> | null = null

export function getUiSnapshot(): UiPreferences {
  const mail = useMailStore.getState()
  return {
    darkMode: useThemeStore.getState().darkMode,
    selectedFolderId: mail.selectedFolderId,
    selectedMessageId: mail.selectedMessageId,
    collapsedAccountIds: mail.collapsedAccountIds,
    favoriteFolderIds: mail.favoriteFolderIds,
    threadedView: mail.threadedView,
    unreadFilterByAccount: mail.unreadFilterByAccount,
    searchField: mail.searchField
  }
}

export function applyUiPreferences(ui: UiPreferences): void {
  useThemeStore.getState().setDarkMode(ui.darkMode ?? false, { persist: false })
  useMailStore.setState({
    selectedFolderId: ui.selectedFolderId ?? 'unified',
    selectedMessageId: ui.selectedMessageId ?? null,
    collapsedAccountIds: ui.collapsedAccountIds ?? {},
    favoriteFolderIds: ui.favoriteFolderIds ?? [],
    threadedView: ui.threadedView ?? true,
    unreadFilterByAccount: ui.unreadFilterByAccount ?? {},
    searchField: ui.searchField ?? 'all'
  })
}

export async function loadPersistedPreferences(): Promise<void> {
  const state = await window.orbitMail.preferences.get()
  applyUiPreferences(state.ui ?? ({} as UiPreferences))
  const mail = useMailStore.getState()
  mail.setImageAllowedSenders(state.imageAllowedSenders ?? [])
  mail.setBlockedSenders(state.blockedSenders ?? [])
  mail.setMutedSenders(state.mutedSenders ?? [])
  // Each global default is written out rather than relying on the main process
  // having supplied it: a blob saved before these keys existed has them absent,
  // and the absent case must mean "what the app did before there was a switch".
  mail.setGlobalPreferences({
    closeToTray: state.closeToTray !== false,
    desktopNotifications: state.desktopNotifications !== false,
    alwaysLoadRemoteImages: state.alwaysLoadRemoteImages === true,
    handleMailtoLinks: state.handleMailtoLinks === true,
    alwaysIncludeAttachments: state.alwaysIncludeAttachments === true,
    // Resolved, not taken as read: the settings pane has to show the model that
    // will actually be called, and main falls back the same way for a value it
    // does not recognise.
    aiModel: resolveAiModel(state.aiModel),
    aiEffort: resolveAiEffort(state.aiEffort),
    aiDetail: resolveAiDetail(state.aiDetail)
  })
}

export function scheduleSaveUiPreferences(patch?: Partial<UiPreferences>): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const ui = { ...getUiSnapshot(), ...patch }
    void window.orbitMail.preferences.saveUi(ui)
  }, 250)
}

/**
 * Persist immediately, and **return the promise**. Quit awaits this: it used to
 * be fire-and-forget, so even a main process that waited for the flush call to
 * return could still exit before the IPC behind it had landed.
 */
export async function saveUiPreferencesNow(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await window.orbitMail.preferences.saveUi(getUiSnapshot())
}

export function exposeFlushHook(): void {
  window.__orbitMailFlush = saveUiPreferencesNow
}

declare global {
  interface Window {
    // Returns a promise so `executeJavaScript` resolves only once the write has
    // actually happened, not merely once it has been asked for.
    __orbitMailFlush?: () => Promise<void>
  }
}
