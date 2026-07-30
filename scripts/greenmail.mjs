// GreenMail container lifecycle, shared by the two runners that need a real
// mail server: scripts/imap-integration.mjs (windowless, runs in CI) and
// scripts/send-e2e.mjs (real windows, local only).
//
// Each runner brings its own container name and host ports so the two can run
// at the same time, and so a container left behind by `test:imap -- --keep`
// does not collide with the other.
import { spawnSync } from 'child_process'

export const IMAGE = 'greenmail/standalone:2.1.9'
export const USER = { email: 'rob@example.com', login: 'rob', password: 'secret' }

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts })

export function dockerAvailable() {
  return run('docker', ['info']).status === 0
}

export function stopContainer(container) {
  run('docker', ['rm', '-f', container], { stdio: 'ignore' })
}

export function containerLogs(container, lines = 40) {
  const logs = run('docker', ['logs', '--tail', String(lines), container])
  return (logs.stdout ?? '') + (logs.stderr ?? '')
}

/**
 * Start GreenMail, replacing any container of the same name.
 *
 * The container's own ports are fixed; only the host side varies, so a caller
 * picks host ports and talks to those. Returns an error string, or null.
 */
export function startGreenMail({ container, ports }) {
  stopContainer(container)
  const opts = [
    '-Dgreenmail.setup.test.all',
    '-Dgreenmail.hostname=0.0.0.0',
    `-Dgreenmail.users=${USER.login}:${USER.password}@example.com`
  ].join(' ')

  const res = run('docker', [
    'run', '-d', '--name', container,
    '-p', `${ports.imap}:3143`,
    '-p', `${ports.imaps}:3993`,
    '-p', `${ports.smtp}:3025`,
    '-e', `GREENMAIL_OPTS=${opts}`,
    IMAGE
  ])
  return res.status === 0 ? null : res.stderr
}

/** Resolves true once IMAP accepts connections, false if it never does. */
export async function waitForImap(port, timeoutMs = 60_000) {
  const { createConnection } = await import('net')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const up = await new Promise((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port })
      socket.setTimeout(1000)
      socket.on('connect', () => { socket.destroy(); resolve(true) })
      socket.on('error', () => resolve(false))
      socket.on('timeout', () => { socket.destroy(); resolve(false) })
    })
    if (up) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
