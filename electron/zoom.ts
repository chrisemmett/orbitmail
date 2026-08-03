/**
 * Page zoom, on the shortcuts a browser uses.
 *
 * Electron ships a default menu whose View submenu already has Zoom In / Zoom
 * Out / Actual Size, so it looks as though this is free. It is not, and the
 * reason is the reason this file exists: those menu roles bind to the
 * *accelerators* `CommandOrControl+Plus` and `CommandOrControl+-`, and an
 * accelerator matches a key, not the character your layout puts on it. On a UK
 * layout `Ctrl` with the `-` key can arrive as `_`, and `+` needs `Shift`, so
 * `Ctrl` `+` never matches at all. The user reported exactly that: "CTRL- seems
 * to be CTRL_ on my machine".
 *
 * So the keys are matched by the character actually produced, every spelling of
 * it, rather than by an accelerator: `+ = _ -` and both `0`s. That covers the
 * main row, the numpad, and layouts where shift is or isn't needed.
 */

import type { BrowserWindow, Input } from 'electron'

/**
 * Electron's zoom level is logarithmic: factor = 1.2 ^ level. These bounds give
 * roughly 58% to 300%, which brackets what a browser offers and stops a
 * mis-keyed shortcut leaving the app at a size it cannot be read at to undo.
 */
export const MIN_ZOOM_LEVEL = -3
export const MAX_ZOOM_LEVEL = 6

export type ZoomAction = 'in' | 'out' | 'reset'

/**
 * Which zoom action a keypress means, or null. Matched on `input.key` — the
 * character produced — because that is what survives a layout that puts `_`
 * where another puts `-`.
 */
export function zoomActionForInput(input: Pick<Input, 'type' | 'key' | 'control' | 'meta' | 'alt'>): ZoomAction | null {
  if (input.type !== 'keyDown') return null
  // Ctrl (or Cmd) alone. Alt would be a different shortcut, not a sloppier
  // spelling of this one.
  if (!(input.control || input.meta) || input.alt) return null

  switch (input.key) {
    // `=` is the unshifted key that carries `+`; `Add` is the numpad.
    case '+':
    case '=':
    case 'Add':
      return 'in'
    // `_` is the shifted `-`, and the one the report came in about.
    case '-':
    case '_':
    case 'Subtract':
      return 'out'
    case '0':
    case 'Insert': // numpad 0 with numlock off
      return 'reset'
    default:
      return null
  }
}

/** The level an action moves to, clamped. `reset` is always 0 — 100%. */
export function nextZoomLevel(current: number, action: ZoomAction): number {
  if (action === 'reset') return 0
  const next = action === 'in' ? current + 1 : current - 1
  return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, next))
}

/** Percentage for the user, e.g. 120. Rounded — nobody wants "119.99%". */
export function zoomPercentage(level: number): number {
  return Math.round(1.2 ** level * 100)
}

/**
 * A stored level, made safe to apply. A hand-edited or corrupted preferences
 * blob must not be able to leave the app at a size the user cannot read well
 * enough to fix, so anything unusable resolves to 100%.
 */
export function sanitizeZoomLevel(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, value))
}

/**
 * Apply the level to a window, and keep it applied.
 *
 * The re-apply on load is not belt-and-braces: a zoom level is a property of
 * the loaded frame, so it resets to 0 on every navigation and reload — which
 * includes the reload used to recover from a dead renderer. Without this, an
 * app that recovered from a crash would silently snap back to 100%.
 */
export function applyZoom(window: BrowserWindow, level: number): void {
  if (window.isDestroyed()) return
  window.webContents.setZoomLevel(level)
}
