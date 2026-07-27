import type { AiPriority, CompletedTask, SweepScope, SweepTask } from '../../shared/types'

const PRIORITY_ORDER: AiPriority[] = ['urgent', 'high', 'medium', 'low']
const PRIORITY_HEADING: Record<AiPriority, string> = {
  urgent: 'Urgent',
  high: 'High priority',
  medium: 'Medium priority',
  low: 'Low priority'
}

export interface TaskExportData {
  tasks: SweepTask[]
  completed: CompletedTask[]
  scope: SweepScope
  analyzedCount: number
  sweptAt: number | null
}

// Flatten to a single line and defuse characters that would break a Markdown
// list item.
function clean(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[[\]]/g, '').trim()
}

function line(task: SweepTask, done: boolean, suffix = ''): string {
  const box = done ? '[x]' : '[ ]'
  const source = clean(`${task.sourceFrom} — ${task.sourceSubject}`)
  return `- ${box} ${clean(task.task)} _(${source})_${suffix}`
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// Render the current sweep as a Markdown checklist grouped by priority, with a
// completed section at the end.
export function buildTasksMarkdown(data: TaskExportData): string {
  const { tasks, completed, scope, analyzedCount, sweptAt } = data
  const scopeLabel = scope === 'all' ? 'message' : 'unread message'
  const countLabel = `${analyzedCount} ${scopeLabel}${analyzedCount === 1 ? '' : 's'}`

  const lines: string[] = ['# Outstanding Tasks', '']

  const meta = [
    `Scope: ${scope === 'all' ? 'All messages' : 'Unread'}`,
    `Reviewed ${countLabel}`,
    sweptAt ? `Swept ${formatDate(sweptAt)}` : null
  ]
    .filter(Boolean)
    .join(' · ')
  lines.push(`_${meta}_`, '')

  if (tasks.length === 0) {
    lines.push('No outstanding tasks. 🎉', '')
  } else {
    for (const priority of PRIORITY_ORDER) {
      const items = tasks.filter((t) => t.priority === priority)
      if (items.length === 0) continue
      lines.push(`## ${PRIORITY_HEADING[priority]}`)
      for (const task of items) lines.push(line(task, false))
      lines.push('')
    }
  }

  if (completed.length > 0) {
    lines.push(`## Completed (${completed.length})`)
    for (const task of completed) {
      lines.push(line(task, true, ` — done ${formatDate(task.completedAt)}`))
    }
    lines.push('')
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

// Suggested filename, e.g. tasks-2026-07-05.md.
export function defaultTasksFilename(now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 10)
  return `tasks-${stamp}.md`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Priority accent colours, copied from the on-screen task list
// (.tasks-group-title.priority-* in apple-mail.css) so the printout matches.
const PRIORITY_COLOR: Record<AiPriority, string> = {
  urgent: '#e5484d',
  high: '#f5a623',
  medium: '#5b5fe8',
  low: '#8b8b96'
}

const PRINT_STYLES = `
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a1a;
    margin: 0;
    padding: 24px 32px;
    line-height: 1.5;
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #666; font-size: 13px; margin: 0 0 20px; padding-bottom: 12px; border-bottom: 2px solid #ddd; }
  h2 {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 20px 0 8px;
  }
  ul { list-style: none; margin: 0; padding: 0; }
  li {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    font-size: 14px;
    padding: 9px 11px;
    margin-bottom: 6px;
    border: 1px solid #e2e2e6;
    border-radius: 8px;
    page-break-inside: avoid;
  }
  .box {
    flex-shrink: 0;
    width: 17px;
    height: 17px;
    margin-top: 1px;
    border: 1.5px solid #c8c8cf;
    border-radius: 5px;
  }
  .item-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .source { color: #8b8b96; font-size: 12px; }
  .empty { font-size: 15px; }
  @page { margin: 1.5cm; }
`

function printItem(task: SweepTask): string {
  const source = escapeHtml(`${task.sourceFrom} — ${task.sourceSubject}`)
  return `<li><span class="box"></span><span class="item-body"><span class="task">${escapeHtml(task.task)}</span><span class="source">${source}</span></span></li>`
}

// Render the current sweep as a self-contained, printable HTML document grouped
// by priority, mirroring the on-screen task list's boxes and priority colours.
// `accountLabel` names the account the tasks belong to and heads the page.
// Completed tasks are deliberately excluded — a printout is a to-do list.
export function buildTasksPrintHtml(data: TaskExportData, accountLabel: string): string {
  const { tasks, scope, analyzedCount, sweptAt } = data
  const scopeLabel = scope === 'all' ? 'message' : 'unread message'
  const countLabel = `${analyzedCount} ${scopeLabel}${analyzedCount === 1 ? '' : 's'}`
  const meta = [
    `Scope: ${scope === 'all' ? 'All messages' : 'Unread'}`,
    `Reviewed ${countLabel}`,
    sweptAt ? `Swept ${formatDate(sweptAt)}` : null
  ]
    .filter(Boolean)
    .join(' · ')

  const body: string[] = []
  if (tasks.length === 0) {
    body.push('<p class="empty">No outstanding tasks. 🎉</p>')
  } else {
    for (const priority of PRIORITY_ORDER) {
      const items = tasks.filter((t) => t.priority === priority)
      if (items.length === 0) continue
      body.push(`<h2 style="color: ${PRIORITY_COLOR[priority]}">${PRIORITY_HEADING[priority]}</h2>`)
      body.push(`<ul>${items.map((t) => printItem(t)).join('')}</ul>`)
    }
  }

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Outstanding Tasks — ${escapeHtml(accountLabel)}</title>
<style>${PRINT_STYLES}</style>
</head>
<body>
<h1>Outstanding Tasks</h1>
<p class="meta">${escapeHtml(accountLabel)}${meta ? ` · ${escapeHtml(meta)}` : ''}</p>
${body.join('\n')}
</body>
</html>`
}
