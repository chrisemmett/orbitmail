import type { ConnectionSecurity, ServerConfig } from '../../../shared/types'

// Host / port / security for one end of a manual account. Lifted out of
// AddAccountWizard unchanged so the settings screen can edit an existing
// account's servers with the same control the wizard sets them with.
export function ServerFields({
  label,
  value,
  onChange
}: {
  label: string
  value: ServerConfig
  onChange: (next: ServerConfig) => void
}) {
  return (
    <fieldset className="account-fieldset">
      <legend>{label}</legend>
      <label className="account-field">
        <span>Server</span>
        <input
          value={value.host}
          onChange={(e) => onChange({ ...value, host: e.target.value })}
          placeholder="mail.example.com"
        />
      </label>
      <div className="account-field-row">
        <label className="account-field">
          <span>Port</span>
          <input
            type="number"
            value={value.port}
            onChange={(e) => onChange({ ...value, port: Number(e.target.value) || 0 })}
          />
        </label>
        <label className="account-field">
          <span>Security</span>
          <select
            value={value.security}
            onChange={(e) => onChange({ ...value, security: e.target.value as ConnectionSecurity })}
          >
            <option value="ssl">SSL/TLS</option>
            <option value="starttls">STARTTLS</option>
            <option value="none">None</option>
          </select>
        </label>
      </div>
    </fieldset>
  )
}
