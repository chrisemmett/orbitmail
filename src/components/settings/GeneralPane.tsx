import { useMailStore, setGlobalPreference, toggleThreadedView } from '../../stores/mailStore'
import { useThemeStore } from '../../stores/themeStore'
import { SettingToggle } from './SettingToggle'

export function GeneralPane() {
  const darkMode = useThemeStore((s) => s.darkMode)
  const setDarkMode = useThemeStore((s) => s.setDarkMode)
  const threadedView = useMailStore((s) => s.threadedView)
  const closeToTray = useMailStore((s) => s.closeToTray)
  const desktopNotifications = useMailStore((s) => s.desktopNotifications)
  const handleMailtoLinks = useMailStore((s) => s.handleMailtoLinks)
  const capabilities = useMailStore((s) => s.platformCapabilities)
  // Null until the main process answers; the panes fall back to the wording
  // that is true of every other desktop rather than guessing at a Mac.
  const isMac = capabilities?.platform === 'darwin'

  return (
    <>
      <section className="settings-section">
        <h3>Appearance</h3>
        <SettingToggle
          label="Dark mode"
          checked={darkMode}
          onChange={(next) => setDarkMode(next)}
        />
        <SettingToggle
          label="Group mail into conversations"
          description="Off shows every message as its own row."
          checked={threadedView}
          onChange={() => toggleThreadedView()}
        />
      </section>

      <section className="settings-section">
        <h3>When you close the window</h3>
        <SettingToggle
          label={isMac ? 'Keep running in the Dock' : 'Keep running in the tray'}
          description={
            isMac
              ? 'Mail keeps syncing and the unread count stays live. Quit with ⌘Q.'
              : "Mail keeps syncing and the unread count stays live. Quit with the tray's Quit, or Ctrl+Q."
          }
          checked={closeToTray}
          disabledReason={
            capabilities && !capabilities.trayActive
              ? isMac
                ? // Not a limitation on a Mac: closing the last window leaves the
                  // app in the Dock by platform convention, which is what this
                  // toggle asks for, so there is nothing left for it to switch.
                  'macOS already does this — closing the window leaves Orbit Mail running in the Dock.'
                : 'This desktop has no system tray, so closing the window always quits.'
              : undefined
          }
          onChange={(next) => void setGlobalPreference('closeToTray', next)}
        />
      </section>

      <section className="settings-section">
        <h3>Notifications</h3>
        <SettingToggle
          label="Notify me about new mail"
          description="The unread count and tray icon keep updating either way."
          checked={desktopNotifications}
          disabledReason={
            capabilities && !capabilities.notificationsSupported
              ? 'This desktop does not support notifications.'
              : undefined
          }
          onChange={(next) => void setGlobalPreference('desktopNotifications', next)}
        />
      </section>

      <section className="settings-section">
        <h3>Default mail app</h3>
        <SettingToggle
          label="Open mailto: links in Orbit Mail"
          description="Clicking an email address on a web page composes here."
          checked={handleMailtoLinks}
          onChange={(next) => void setGlobalPreference('handleMailtoLinks', next)}
        />
        <p className="account-hint">
          This registers Orbit Mail with your desktop, which needs an installed copy — it will not
          stick when running from a development build.
        </p>
      </section>
    </>
  )
}
