/**
 * HTML to plain text, for feeding a model rather than for display.
 *
 * Lifted out of `ai-service.ts` when `eml-text.ts` needed it too: the analysis
 * service imports the extractors, so an extractor importing the analysis
 * service back would be a cycle.
 *
 * Deliberately lossy and deliberately not a parser. This is used on content the
 * sender wrote, and its job is to leave text the model can read — not to
 * preserve structure and not to sanitize for a DOM, which is `dompurify`'s job
 * in the renderer and a different problem.
 */
export function stripHtml(html: string): string {
  return html
    // Script and style hold text that is not content; dropping the tags alone
    // would spill CSS and JavaScript into the prompt.
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}
