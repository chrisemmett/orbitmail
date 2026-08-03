import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Catches a render-time error so it does not take the whole window with it.
 *
 * Without this, React 18 unmounts the entire tree when a render throws, and the
 * app becomes a white rectangle — permanently, with the renderer process still
 * alive and the title bar still updating its unread count, so it does not even
 * look like a crash. There is no way back except quitting and reopening, and
 * nothing anywhere records what happened.
 *
 * So this does two jobs, and the second matters more: it gives the user a way
 * out, and it writes the error down. A blank window is unfixable if the only
 * evidence lives in a console nobody opened.
 *
 * What it cannot catch: errors thrown in event handlers, in promises, or in
 * `setTimeout` callbacks. Those never reach a boundary — the global listeners
 * installed in `main.tsx` report them instead.
 */
interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  componentStack: string | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null })
    // Report before rendering the panel: if reporting itself fails, the user
    // still gets the way out. Resolved through a local first — when the preload
    // bridge is missing this is `undefined`, and calling `.catch` on it would
    // throw inside the handler whose whole job is to survive a throw.
    const report = window.orbitMail?.app?.reportRendererError
    if (report) {
      void Promise.resolve(
        report({
          source: 'render',
          message: error.message || String(error),
          stack: error.stack,
          componentStack: info.componentStack ?? undefined,
          window: window.location.hash || 'main'
        })
      ).catch(() => {
        /* nothing useful to do if even the report cannot be sent */
      })
    }
  }

  render(): ReactNode {
    const { error, componentStack } = this.state
    if (!error) return this.props.children

    return (
      <div className="crash-screen" role="alert">
        <div className="crash-panel">
          <h1>Orbit Mail hit a display error</h1>
          <p>
            Something went wrong drawing this window. <strong>Your mail is safe</strong> — it is
            stored on this computer, and nothing has been sent or deleted.
          </p>
          <p>Reloading usually clears it. If it keeps happening, the details below say why.</p>
          <div className="crash-actions">
            <button type="button" className="crash-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
          <details className="crash-details">
            <summary>Technical details</summary>
            <pre>
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ''}
              {componentStack ? `\n\nComponent stack:${componentStack}` : ''}
            </pre>
            <p className="crash-note">
              This has also been written to <code>renderer-errors.log</code> in your Orbit Mail
              settings folder.
            </p>
          </details>
        </div>
      </div>
    )
  }
}
