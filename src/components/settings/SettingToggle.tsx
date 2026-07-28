// A labelled on/off row.
//
// The switch is the same `role="switch"` button the theme toggle uses
// (Toolbar.tsx, styled `.theme-switch`) rather than a checkbox — there is no
// checkbox anywhere in this app, and introducing one here would be the only
// one.
//
// `disabledReason` exists so a control can be shown but honestly dead: on a
// desktop with no system tray, "minimise to tray on close" cannot do anything,
// and a switch that flips while nothing happens is worse than one that explains
// itself.
interface SettingToggleProps {
  label: string
  description?: string
  checked: boolean
  disabledReason?: string
  onChange: (next: boolean) => void
}

export function SettingToggle({
  label,
  description,
  checked,
  disabledReason,
  onChange
}: SettingToggleProps) {
  const disabled = !!disabledReason
  return (
    <div className={`setting-row${disabled ? ' is-disabled' : ''}`}>
      <div className="setting-row-text">
        <span className="setting-row-label">{label}</span>
        {(disabledReason || description) && (
          <span className="setting-row-description">{disabledReason ?? description}</span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        // `.theme-switch` paints its on-state from [aria-checked], so the state
        // above is the whole story — no modifier class.
        className="theme-switch"
        onClick={() => onChange(!checked)}
      />
    </div>
  )
}
