import { useMailStore, setGlobalPreference, updateSenderList } from '../../stores/mailStore'
import { SettingToggle } from './SettingToggle'

function SenderList({
  senders,
  emptyText,
  actionLabel,
  onAction
}: {
  senders: string[]
  emptyText: string
  actionLabel: string
  onAction: (email: string) => void
}) {
  if (senders.length === 0) return <p className="account-hint">{emptyText}</p>
  return (
    <ul className="settings-sender-list">
      {senders.map((sender) => (
        <li key={sender} className="settings-sender-row">
          <span className="settings-sender-address" title={sender}>
            {sender}
          </span>
          <button
            type="button"
            className="btn btn-secondary settings-sender-action"
            onClick={() => onAction(sender)}
          >
            {actionLabel}
          </button>
        </li>
      ))}
    </ul>
  )
}

export function PrivacyPane() {
  const alwaysLoadRemoteImages = useMailStore((s) => s.alwaysLoadRemoteImages)
  const allowed = useMailStore((s) => s.imageAllowedSenders)
  const blocked = useMailStore((s) => s.blockedSenders)
  const muted = useMailStore((s) => s.mutedSenders)

  return (
    <>
      <section className="settings-section">
        <h3>Blocked senders</h3>
        <p className="account-hint">
          Mail from these addresses is hidden from your lists, your searches and your unread
          counts. It is not deleted — unblocking brings it straight back, and nothing is ever
          removed from your mail server.
        </p>
        <SenderList
          senders={blocked}
          emptyText="Nobody is blocked. Right-click a message and choose Block sender to add one."
          actionLabel="Unblock"
          onAction={(email) => void updateSenderList('unblock', email)}
        />
      </section>

      <section className="settings-section">
        <h3>Muted senders</h3>
        <p className="account-hint">
          Mail from these addresses arrives and is listed as normal, but never raises a desktop
          notification.
        </p>
        <SenderList
          senders={muted}
          emptyText="Nobody is muted."
          actionLabel="Unmute"
          onAction={(email) => void updateSenderList('unmute', email)}
        />
      </section>

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
        <SenderList
          senders={allowed}
          emptyText="No senders are always-allowed yet."
          actionLabel="Remove"
          onAction={(email) => void updateSenderList('revokeImages', email)}
        />
      </section>
    </>
  )
}
