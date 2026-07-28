import { useMailStore, setGlobalPreference } from '../../stores/mailStore'
import { SettingToggle } from './SettingToggle'

// Remote images only. The muted and blocked sender lists are deliberately not
// shown yet: neither does anything to your mail today, and listing them here
// would imply otherwise. They arrive with the change that makes them work.
export function PrivacyPane() {
  const alwaysLoadRemoteImages = useMailStore((s) => s.alwaysLoadRemoteImages)
  const allowed = useMailStore((s) => s.imageAllowedSenders)

  return (
    <>
      <section className="settings-section">
        <h3>Remote images</h3>
        <p className="account-hint">
          Images hosted on a sender&apos;s server are blocked until you ask for them, because
          loading one tells the sender you opened the mail, and when.
        </p>
        <SettingToggle
          label="Always load remote images"
          description="Turns off the per-message prompt for every sender."
          checked={alwaysLoadRemoteImages}
          onChange={(next) => void setGlobalPreference('alwaysLoadRemoteImages', next)}
        />
      </section>

      <section className="settings-section">
        <h3>Senders you always load images for</h3>
        {allowed.length === 0 ? (
          <p className="account-hint">
            None yet. Choosing &ldquo;Always load images from this sender&rdquo; on a message adds
            them here.
          </p>
        ) : (
          <ul className="settings-sender-list">
            {allowed.map((sender) => (
              <li key={sender} className="settings-sender-row">
                <span className="settings-sender-address">{sender}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="account-hint">
          Removing a sender from this list is not possible yet — it is coming with the sender
          controls.
        </p>
      </section>
    </>
  )
}
