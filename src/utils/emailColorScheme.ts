// Does a message's own styling assume it is being read on a light page?
//
// Sender HTML is rendered inside the app document, so in dark mode it lands on
// `--bg-main` (#1e1e24). Mail is overwhelmingly authored for a white page, and
// an inline `style` attribute beats our stylesheet — so `.reader-body`'s theme
// colours lose and the message is painted with colours chosen for a canvas it
// is not on. That shows up two ways, and both were reported as "unreadable":
//
//   - the sender sets dark text and no background — near-black on our dark grey;
//   - the sender sets a light background and no text colour — our own light
//     text on the sender's white table.
//
// Inline attributes are the *only* place a colour can come from: the sanitizer
// forbids `<style>` and `<link>`, so a head stylesheet never applies and any
// colour it named is already gone by the time this runs.
//
// When this returns true the reader gives that message a light surface to sit
// on, rather than trying to rewrite the sender's colours. Rewriting means
// guessing which foreground goes with which background, and getting that pair
// wrong reproduces the very bug being fixed; a light surface is correct by
// construction because it is the canvas the sender assumed.

/** Relative luminance (WCAG 2.x) of an sRGB triple. 0 = black, 1 = white. */
function luminance(r: number, g: number, b: number): number {
  const channel = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio between two luminances, 1 (identical) to 21 (black/white). */
function contrast(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

// The dark theme's own surface and text, from `:root[data-theme='dark']` in
// apple-mail.css. The thresholds below are derived from these rather than
// picked, so the rule is "would this actually be unreadable on our dark
// background" and not a guess at what counts as a dark colour.
const DARK_SURFACE = luminance(0x1e, 0x1e, 0x24)
const DARK_TEXT = luminance(0xf4, 0xf4, 0xf8)

/** The AA bar for body text. Below this we treat the pairing as unreadable. */
const MIN_CONTRAST = 4.5

const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  silver: [192, 192, 192],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  darkgray: [169, 169, 169],
  darkgrey: [169, 169, 169],
  dimgray: [105, 105, 105],
  dimgrey: [105, 105, 105],
  lightgray: [211, 211, 211],
  lightgrey: [211, 211, 211],
  whitesmoke: [245, 245, 245],
  ivory: [255, 255, 240],
  navy: [0, 0, 128],
  maroon: [128, 0, 0],
  darkblue: [0, 0, 139],
  darkgreen: [0, 100, 0],
  darkred: [139, 0, 0],
  midnightblue: [25, 25, 112]
}

const HEX = /#([0-9a-f]{3,8})\b/i
const RGB = /rgba?\(\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)/i

function channelValue(token: string): number {
  const n = parseFloat(token)
  if (Number.isNaN(n)) return 0
  return token.trim().endsWith('%') ? Math.round((n / 100) * 255) : n
}

/**
 * Luminance of the first colour in a CSS value, or null when there is no colour
 * to read — `transparent`, `inherit`, a bare `url(...)` background, or anything
 * fully transparent, none of which paint anything and so imply nothing.
 */
function valueLuminance(value: string): number | null {
  const v = value.trim().toLowerCase()
  if (!v || v === 'transparent' || v === 'inherit' || v === 'initial' || v === 'currentcolor') {
    return null
  }

  const rgb = RGB.exec(v)
  if (rgb) {
    if (rgb[4] !== undefined) {
      const alpha = rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4])
      if (!Number.isNaN(alpha) && alpha <= 0.1) return null
    }
    return luminance(channelValue(rgb[1]), channelValue(rgb[2]), channelValue(rgb[3]))
  }

  const hex = HEX.exec(v)
  if (hex) {
    const h = hex[1]
    if (h.length === 3 || h.length === 4) {
      if (h.length === 4 && parseInt(h[3] + h[3], 16) <= 25) return null
      return luminance(
        parseInt(h[0] + h[0], 16),
        parseInt(h[1] + h[1], 16),
        parseInt(h[2] + h[2], 16)
      )
    }
    if (h.length === 6 || h.length === 8) {
      if (h.length === 8 && parseInt(h.slice(6, 8), 16) <= 25) return null
      return luminance(
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16)
      )
    }
    return null
  }

  for (const word of v.split(/[^a-z]+/)) {
    const named = NAMED[word]
    if (named) return luminance(named[0], named[1], named[2])
  }
  return null
}

/** Text this colour would be unreadable on our dark surface. */
function isTextForLightPage(value: string): boolean {
  const lum = valueLuminance(value)
  return lum !== null && contrast(lum, DARK_SURFACE) < MIN_CONTRAST
}

/** Our own light text would be unreadable on a background this colour. */
function isBackgroundForDarkText(value: string): boolean {
  const lum = valueLuminance(value)
  return lum !== null && contrast(DARK_TEXT, lum) < MIN_CONTRAST
}

const STYLE_ATTR = /style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
const BGCOLOR_ATTR = /\bbgcolor\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
// `color=` on <font>. The leading boundary keeps it off `bgcolor=`.
const COLOR_ATTR = /(?:^|[\s"'])color\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi

function firstGroup(m: RegExpExecArray): string {
  return m[1] ?? m[2] ?? m[3] ?? ''
}

/**
 * True when the message's own colours only make sense on a light page.
 *
 * Takes the *sanitized* HTML — the point is to judge what will actually be
 * painted, and sanitizing is what decides that. Pure string work rather than a
 * DOM walk so it can be exercised under `npm run test:store`, which runs in
 * plain node with no DOM at all.
 */
export function assumesLightBackground(html: string | null | undefined): boolean {
  if (!html) return false

  STYLE_ATTR.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = STYLE_ATTR.exec(html)) !== null) {
    const declarations = match[1] ?? match[2] ?? ''
    for (const declaration of declarations.split(';')) {
      const colon = declaration.indexOf(':')
      if (colon < 0) continue
      // Compared as whole property names, so `background-color` can never be
      // mistaken for `color` the way a substring search would.
      const property = declaration.slice(0, colon).trim().toLowerCase()
      const value = declaration.slice(colon + 1)
      if (property === 'color') {
        if (isTextForLightPage(value)) return true
      } else if (property === 'background' || property === 'background-color') {
        if (isBackgroundForDarkText(value)) return true
      }
    }
  }

  BGCOLOR_ATTR.lastIndex = 0
  while ((match = BGCOLOR_ATTR.exec(html)) !== null) {
    if (isBackgroundForDarkText(firstGroup(match))) return true
  }

  COLOR_ATTR.lastIndex = 0
  while ((match = COLOR_ATTR.exec(html)) !== null) {
    if (isTextForLightPage(firstGroup(match))) return true
  }

  return false
}
