import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles/apple-mail.css'
import './stores/themeStore'

// An error boundary only sees render and lifecycle errors. Anything thrown in
// an event handler, a promise or a timer bypasses it entirely — those do not
// blank the window, but they are exactly the failures that leave no trace, so
// they are reported too. Reporting only: the UI is still usable, and replacing
// it with a crash screen because one async call rejected would be worse than
// the bug.
function reportGlobalError(message: string, stack?: string): void {
  const report = window.orbitMail?.app?.reportRendererError
  if (!report) return
  void Promise.resolve(report({ source: 'render', message, stack })).catch(() => {
    /* the reporting channel is the last thing that can help; nothing below it */
  })
}

window.addEventListener('error', (event) => {
  reportGlobalError(event.message || 'Uncaught error', event.error?.stack)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  reportGlobalError(
    reason instanceof Error ? reason.message : `Unhandled rejection: ${String(reason)}`,
    reason instanceof Error ? reason.stack : undefined
  )
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
