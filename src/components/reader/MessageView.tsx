import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AiAnalysis,
  DraftTone,
  MessageDetail,
  ThreadActionItem
} from '../../../shared/types'
import { sanitizeEmailHtml } from '../../utils/sanitizeEmailHtml'
import { assumesLightBackground } from '../../utils/emailColorScheme'
import { RemoteContentBar, useRemoteImageBlocking } from './RemoteContentBar'
import {
  useMailStore,
  toggleMessageStar,
  toggleThreadMessageStar,
  analyzeMessage,
  analyzeThread,
  expandKey,
  draftReply,
  flagMessageAsTask,
  retryReaderLoad,
  openDraft,
  discardDraft
} from '../../stores/mailStore'
import { EmptyState } from '../EmptyState'
import { MessageContextMenu } from '../messages/MessageContextMenu'
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu'
import {
  Paperclip,
  EnvelopeSimpleOpen,
  Flag,
  Sparkle,
  CaretRight,
  ArrowBendUpLeft,
  ArrowBendDoubleUpLeft,
  ArrowBendUpRight,
  PencilSimple,
  Trash,
  Printer,
  ListChecks,
  TrayArrowDown
} from '../icons'
import { flagColorHex } from '../../constants/flags'
import { printMessageDetail, printThreadDetails } from '../../utils/printMessage'

function extractName(from: string): string {
  const match = from.match(/^(.+?)\s*</)
  if (match) return match[1].replace(/"/g, '').trim()
  return from
}

const DRAFT_TONES: { value: DraftTone; label: string; hint: string }[] = [
  { value: 'brief', label: 'Brief', hint: '2–4 sentences' },
  { value: 'neutral', label: 'Neutral', hint: 'Standard length' },
  { value: 'detailed', label: 'Detailed', hint: 'Thorough' }
]

// "Draft reply ▾" split-button: choose who it goes to, pick a tone, generate a
// draft, open the composer. Recipients are a sticky toggle rather than six menu
// rows (3 tones × 2 modes) — one click sets it, and it stays put for the next
// draft, so the common case is still a single click on a tone.
function DraftReplyButton({ messageId }: { messageId: string }) {
  const draftingReplyId = useMailStore((s) => s.draftingReplyId)
  const draftReplyMode = useMailStore((s) => s.draftReplyMode)
  const setDraftReplyMode = useMailStore((s) => s.setDraftReplyMode)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const isDrafting = draftingReplyId === messageId

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const pick = (tone: DraftTone) => {
    setOpen(false)
    void draftReply(messageId, tone, draftReplyMode)
  }

  const isAll = draftReplyMode === 'reply-all'
  const label = isDrafting ? 'Drafting…' : isAll ? 'Draft reply all' : 'Draft reply'

  return (
    <div className="draft-reply" ref={ref}>
      <button
        type="button"
        className="reader-ai-btn"
        disabled={isDrafting}
        title={isAll ? 'Draft an AI reply to everyone' : 'Draft an AI reply to the sender'}
        onClick={() => setOpen((o) => !o)}
      >
        <Sparkle size={16} weight="duotone" />
        {label}
        <CaretRight
          size={12}
          weight="bold"
          style={{ transform: 'rotate(90deg)', opacity: 0.7 }}
        />
      </button>
      {open && !isDrafting && (
        <div className="draft-reply-menu">
          <div className="draft-reply-modes" role="radiogroup" aria-label="Reply recipients">
            <button
              type="button"
              role="radio"
              aria-checked={!isAll}
              className={`draft-reply-mode${isAll ? '' : ' active'}`}
              title="Reply to the sender only"
              onClick={() => setDraftReplyMode('reply')}
            >
              <ArrowBendUpLeft size={14} weight="duotone" />
              Reply
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={isAll}
              className={`draft-reply-mode${isAll ? ' active' : ''}`}
              title="Reply to everyone on the message"
              onClick={() => setDraftReplyMode('reply-all')}
            >
              <ArrowBendDoubleUpLeft size={14} weight="duotone" />
              Reply All
            </button>
          </div>
          <div className="draft-reply-tones" role="menu">
            {DRAFT_TONES.map((t) => (
              <button
                key={t.value}
                type="button"
                className="draft-reply-option"
                role="menuitem"
                onClick={() => pick(t.value)}
              >
                <span className="draft-reply-option-label">{t.label}</span>
                <span className="draft-reply-option-hint">{t.hint}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// "Analyze" button. When the message has attachments, opens a small menu so the
// user chooses whether to include them — attachments cost extra tokens, so it's
// an explicit opt-in. With no attachments it analyzes the body directly.
function AnalyzeButton({ message, iconSize = 16 }: { message: MessageDetail; iconSize?: number }) {
  const aiAnalysis = useMailStore((s) => s.aiAnalysisById[message.id])
  const aiAnalyzingId = useMailStore((s) => s.aiAnalyzingId)
  const isAnalyzing = aiAnalyzingId === message.id
  const hasAttachments = message.attachments.length > 0
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const run = (includeAttachments: boolean) => {
    setOpen(false)
    void analyzeMessage(message.id, !!aiAnalysis, includeAttachments)
  }

  const label = isAnalyzing ? 'Analyzing…' : aiAnalysis ? 'Re-analyze' : 'Analyze'
  const title = aiAnalysis ? 'Re-run AI analysis' : 'Analyze with AI'

  if (!hasAttachments) {
    return (
      <button
        type="button"
        className="reader-ai-btn"
        title={title}
        disabled={isAnalyzing}
        onClick={() => run(false)}
      >
        <Sparkle size={iconSize} weight={aiAnalysis ? 'fill' : 'duotone'} />
        {label}
      </button>
    )
  }

  return (
    <div className="draft-reply" ref={ref}>
      <button
        type="button"
        className="reader-ai-btn"
        title={title}
        disabled={isAnalyzing}
        onClick={() => setOpen((o) => !o)}
      >
        <Sparkle size={iconSize} weight={aiAnalysis ? 'fill' : 'duotone'} />
        {label}
        <CaretRight
          size={12}
          weight="bold"
          style={{ transform: 'rotate(90deg)', opacity: 0.7 }}
        />
      </button>
      {open && !isAnalyzing && (
        <div className="draft-reply-menu" role="menu">
          <button
            type="button"
            className="draft-reply-option"
            role="menuitem"
            onClick={() => run(false)}
          >
            <span className="draft-reply-option-label">Text only</span>
            <span className="draft-reply-option-hint">Message body</span>
          </button>
          <button
            type="button"
            className="draft-reply-option"
            role="menuitem"
            onClick={() => run(true)}
          >
            <span className="draft-reply-option-label">Include attachments</span>
            <span className="draft-reply-option-hint">Uses more tokens</span>
          </button>
        </div>
      )}
    </div>
  )
}

// Print button. Plain when there's no AI summary; a split-button with a
// "Print with AI summary" option when a cached analysis exists for the message.
function PrintButton({
  message,
  aiAnalysis
}: {
  message: MessageDetail
  aiAnalysis?: AiAnalysis
}) {
  const setToast = useMailStore((s) => s.setToast)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const print = async (withAi: boolean) => {
    setOpen(false)
    try {
      await printMessageDetail(message, withAi ? aiAnalysis : undefined)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Print failed')
    }
  }

  if (!aiAnalysis) {
    return (
      <button
        type="button"
        className="reader-ai-btn"
        title="Print this message"
        onClick={() => void print(false)}
      >
        <Printer size={16} weight="duotone" />
        Print
      </button>
    )
  }

  return (
    <div className="draft-reply" ref={ref}>
      <button
        type="button"
        className="reader-ai-btn"
        title="Print this message"
        onClick={() => setOpen((o) => !o)}
      >
        <Printer size={16} weight="duotone" />
        Print
        <CaretRight size={12} weight="bold" style={{ transform: 'rotate(90deg)', opacity: 0.7 }} />
      </button>
      {open && (
        <div className="draft-reply-menu" role="menu">
          <button
            type="button"
            className="draft-reply-option"
            role="menuitem"
            onClick={() => void print(false)}
          >
            <span className="draft-reply-option-label">Print</span>
            <span className="draft-reply-option-hint">Message only</span>
          </button>
          <button
            type="button"
            className="draft-reply-option"
            role="menuitem"
            onClick={() => void print(true)}
          >
            <span className="draft-reply-option-label">Print with AI summary</span>
            <span className="draft-reply-option-hint">Includes summary + actions</span>
          </button>
        </div>
      )}
    </div>
  )
}

// "Add to tasks" — force this email into the current task list; the model picks
// the action. A manual task that automatic sweeps won't remove.
function FlagTaskButton({ messageId }: { messageId: string }) {
  const flaggingTaskId = useMailStore((s) => s.flaggingTaskId)
  const isFlagging = flaggingTaskId === messageId
  return (
    <button
      type="button"
      className="reader-ai-btn"
      title="Use AI to add an action from this email to your tasks"
      disabled={isFlagging}
      onClick={() => void flagMessageAsTask(messageId)}
    >
      <ListChecks size={16} weight="duotone" />
      {isFlagging ? 'Adding…' : 'Add to tasks'}
    </button>
  )
}

export function MessageView() {
  const selectedMessage = useMailStore((s) => s.selectedMessage)
  const selectedMessageId = useMailStore((s) => s.selectedMessageId)
  const selectionCount = useMailStore((s) => s.selectedMessageIds.length)
  const selectedThread = useMailStore((s) => s.selectedThread)
  const selectedThreadId = useMailStore((s) => s.selectedThreadId)
  const threadLoading = useMailStore((s) => s.threadLoading)
  const readerError = useMailStore((s) => s.readerError)
  const readerLoading = useMailStore((s) => s.readerLoading)
  const setToast = useMailStore((s) => s.setToast)
  const aiAnalysis = useMailStore((s) =>
    selectedMessageId ? s.aiAnalysisById[selectedMessageId] : undefined
  )
  const aiAnalyzingId = useMailStore((s) => s.aiAnalyzingId)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  // Sanitizing a large email is expensive; only redo it when the message body
  // actually changes, not on every unrelated store update (star, AI, selection).
  const remoteImages = useRemoteImageBlocking(
    selectedMessage?.id ?? '',
    selectedMessage?.from ?? '',
    selectedMessage?.bodyHtml
  )
  const sanitizedHtml = useMemo(
    () => sanitizeEmailHtml(selectedMessage?.bodyHtml, { blockRemoteContent: remoteImages.blocked }),
    [selectedMessage?.id, selectedMessage?.bodyHtml, remoteImages.blocked]
  )
  // Memoized rather than computed inline: it scans the whole body, and the
  // reader re-renders on every hover and selection change.
  const bodyPaper = useMemo(() => assumesLightBackground(sanitizedHtml), [sanitizedHtml])

  // A failed open takes priority over every empty state below: those all read as
  // "nothing selected", which is the wrong story when a fetch just failed.
  if (readerError) {
    return (
      <EmptyState
        icon={<EnvelopeSimpleOpen size={48} weight="duotone" />}
        title="Couldn’t open this"
        description={readerError.message}
        action={{ label: 'Try again', onClick: () => void retryReaderLoad() }}
      />
    )
  }

  // Conversation mode: a thread is open (takes priority over single-message).
  // The id is part of the condition rather than asserted non-null: it is what
  // keys the conversation summary, and a thread rendered without one would look
  // fine while silently sharing another conversation's cache entry.
  if (selectedThread && selectedThread.length > 0 && selectedThreadId) {
    return <ThreadView messages={selectedThread} threadId={selectedThreadId} />
  }
  if (threadLoading && !selectedThread) {
    return (
      <EmptyState
        icon={<EnvelopeSimpleOpen size={48} weight="duotone" />}
        title="Loading conversation…"
        description="Fetching the full thread"
      />
    )
  }

  if (selectionCount > 1) {
    return (
      <EmptyState
        icon={<EnvelopeSimpleOpen size={48} weight="duotone" />}
        title={`${selectionCount} messages selected`}
        description="Press Delete to move them to Trash, or select a single message to read it"
      />
    )
  }

  if (!selectedMessageId || !selectedMessage) {
    return (
      <EmptyState
        icon={<EnvelopeSimpleOpen size={48} weight="duotone" />}
        title="Select a message"
        description="Choose a conversation from the list to read it here"
      />
    )
  }

  const isAnalyzing = aiAnalyzingId === selectedMessageId

  const handleBodyClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    const anchor = target.closest('a')
    if (!anchor) return
    const href = anchor.getAttribute('href')
    if (!href || href.startsWith('#')) return
    event.preventDefault()
    void window.orbitMail.shell.openExternal(href)
  }

  const handleToggleStar = async () => {
    try {
      await toggleMessageStar(selectedMessage.id, !selectedMessage.isStarred)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Update failed')
    }
  }

  const handleReply = () => {
    void window.orbitMail.compose.open({
      accountId: selectedMessage.accountId,
      mode: 'reply',
      originalMessageId: selectedMessage.id
    })
  }

  const handleReplyAll = () => {
    void window.orbitMail.compose.open({
      accountId: selectedMessage.accountId,
      mode: 'reply-all',
      originalMessageId: selectedMessage.id
    })
  }

  const handleForward = () => {
    void window.orbitMail.compose.open({
      accountId: selectedMessage.accountId,
      mode: 'forward',
      originalMessageId: selectedMessage.id
    })
  }

  return (
    <div
      onContextMenu={(event) => {
        event.preventDefault()
        setContextMenu({ x: event.clientX, y: event.clientY })
      }}
    >
      <div className="reader-header">
        <div className="reader-header-top">
          <div className="reader-subject">{selectedMessage.subject}</div>
          <div className="reader-header-actions">
            {selectedMessage.draftId ? (
              // A draft is unsent, so replying to or forwarding it is
              // meaningless. The two things worth doing are finishing it and
              // throwing it away.
              <>
                <button
                  type="button"
                  className="reader-ai-btn primary"
                  title="Carry on writing this draft"
                  onClick={() => void openDraft(selectedMessage.draftId!)}
                >
                  <PencilSimple size={16} weight="duotone" />
                  Continue editing
                </button>
                <button
                  type="button"
                  className="reader-ai-btn"
                  title="Delete this draft"
                  onClick={() => void discardDraft(selectedMessage.draftId!)}
                >
                  <Trash size={16} weight="duotone" />
                  Discard draft
                </button>
              </>
            ) : (
              <>
            <button
              type="button"
              className="reader-ai-btn primary"
              title="Reply to this message"
              onClick={handleReply}
            >
              <ArrowBendUpLeft size={16} weight="duotone" />
              Reply
            </button>
            <button
              type="button"
              className="reader-ai-btn"
              title="Reply to everyone"
              onClick={handleReplyAll}
            >
              <ArrowBendDoubleUpLeft size={16} weight="duotone" />
              Reply All
            </button>
            <button
              type="button"
              className="reader-ai-btn"
              title="Forward this message"
              onClick={handleForward}
            >
              <ArrowBendUpRight size={16} weight="duotone" />
              Forward
            </button>
            <DraftReplyButton messageId={selectedMessage.id} />
            <AnalyzeButton message={selectedMessage} />
            <FlagTaskButton messageId={selectedMessage.id} />
            <PrintButton message={selectedMessage} aiAnalysis={aiAnalysis} />
            </>
            )}

            <button
              type="button"
              className={`reader-star-btn${selectedMessage.isStarred ? ' active' : ''}`}
              title={selectedMessage.isStarred ? 'Remove star' : 'Star message'}
              onClick={handleToggleStar}
            >
              <Flag
                size={18}
                weight="fill"
                style={{ color: flagColorHex(selectedMessage.flagColor) ?? '#f5a623' }}
              />
            </button>
          </div>
        </div>
        <div className="reader-meta">
          <div>
            <strong>From:</strong> {selectedMessage.from}
          </div>
          <div>
            <strong>To:</strong> {selectedMessage.to}
          </div>
          {selectedMessage.cc && (
            <div>
              <strong>Cc:</strong> {selectedMessage.cc}
            </div>
          )}
          <div>
            <strong>Date:</strong>{' '}
            {new Date(selectedMessage.date).toLocaleString()}
          </div>
        </div>
      </div>

      <AttachmentList
        attachments={selectedMessage.attachments}
        messageId={selectedMessage.id}
      />

      {(aiAnalysis || isAnalyzing) && (
        <div className="reader-ai-panel">
          <div className="reader-ai-panel-header">
            <Sparkle size={14} weight="fill" />
            <span>AI Analysis</span>
            {aiAnalysis && !isAnalyzing && (
              <button
                type="button"
                className="reader-ai-regenerate"
                onClick={() => void analyzeMessage(selectedMessage.id, true)}
              >
                Regenerate
              </button>
            )}
          </div>
          {isAnalyzing && !aiAnalysis ? (
            <div className="reader-ai-loading">Analyzing this message…</div>
          ) : aiAnalysis ? (
            <div className="reader-ai-body">
              <p className="reader-ai-summary">{aiAnalysis.summary}</p>
              <AiSection title="Action Items" items={aiAnalysis.actionItems} />
              <AiSection title="Questions" items={aiAnalysis.questions} />
              <AiSection title="Key Context" items={aiAnalysis.keyContext} />
              <AiSkippedAttachments files={aiAnalysis.skippedAttachments} />
            </div>
          ) : null}
        </div>
      )}

      {remoteImages.blocked && (
        <RemoteContentBar
          sender={remoteImages.senderEmail}
          onLoadOnce={remoteImages.loadOnce}
          onAlwaysAllow={remoteImages.alwaysAllow}
        />
      )}
      <div className="reader-body" onClick={handleBodyClick}>
        {sanitizedHtml ? (
          <div
            className={bodyPaper ? 'email-html-paper' : undefined}
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
          />
        ) : readerLoading && !selectedMessage.bodyText ? (
          <div className="reader-body-loading">Loading message…</div>
        ) : (
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
            {selectedMessage.bodyText ?? 'No content'}
          </pre>
        )}
      </div>

      {contextMenu && (
        <MessageContextMenu
          message={selectedMessage}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

// Names the attachments the model never saw. This is a caveat on the answer
// above it, not a section of the answer: a summary produced without the agenda
// reads exactly like one produced with it, and a toast that has already
// vanished is no way to tell them apart.
function AiSkippedAttachments({ files }: { files?: string[] }) {
  if (!files || files.length === 0) return null
  return (
    <div className="reader-ai-skipped">
      Not included in this analysis: {files.join(', ')}
    </div>
  )
}

function AiSection({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null
  return (
    <div className="reader-ai-section">
      <div className="reader-ai-section-title">{title}</div>
      <ul>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

// Action items from a conversation carry an owner. Same markup as AiSection so
// the two panels read as one thing; the owner leads because "who owes this" is
// the question a thread summary is being asked.
function AiOwnerSection({ title, items }: { title: string; items: ThreadActionItem[] }) {
  if (!items || items.length === 0) return null
  return (
    <div className="reader-ai-section">
      <div className="reader-ai-section-title">{title}</div>
      <ul>
        {items.map((item, i) => (
          <li key={i}>
            <strong>{item.owner}</strong>
            {' — '}
            {item.action}
          </li>
        ))}
      </ul>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Attachment chips shared by the single-message and thread readers. Each chip
// opens on click; a trailing button saves it to disk, and "Save all" appears
// when a message carries more than one attachment.
function AttachmentList({
  attachments,
  messageId
}: {
  attachments: MessageDetail['attachments']
  messageId: string
}) {
  const setToast = useMailStore((s) => s.setToast)
  const [busy, setBusy] = useState<{ id: string; kind: 'open' | 'save' } | null>(null)
  const [savingAll, setSavingAll] = useState(false)
  const [menu, setMenu] = useState<{
    x: number
    y: number
    att: MessageDetail['attachments'][number]
  } | null>(null)
  const anyBusy = busy !== null || savingAll

  if (attachments.length === 0) return null

  const handleOpen = async (id: string) => {
    if (anyBusy) return
    setBusy({ id, kind: 'open' })
    try {
      const opened = await window.orbitMail.attachments.open(id)
      // Declined at the "this may run code" prompt — say so, rather than
      // leaving the click looking like it did nothing.
      if (!opened) setToast('Attachment not opened')
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Failed to open attachment')
    } finally {
      setBusy(null)
    }
  }

  const handleSave = async (id: string, filename: string) => {
    if (anyBusy) return
    setBusy({ id, kind: 'save' })
    try {
      const saved = await window.orbitMail.attachments.saveAs(id)
      if (saved) setToast(`Saved ${filename}`)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Failed to save attachment')
    } finally {
      setBusy(null)
    }
  }

  const handleSaveAll = async () => {
    if (anyBusy) return
    setSavingAll(true)
    try {
      const count = await window.orbitMail.attachments.saveAll(messageId)
      if (count != null) setToast(`Saved ${count} attachment${count === 1 ? '' : 's'}`)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Failed to save attachments')
    } finally {
      setSavingAll(false)
    }
  }

  const menuItems: ContextMenuItem[] = menu
    ? [
        {
          id: 'open',
          label: 'Open attachment',
          icon: <Paperclip size={14} weight="duotone" />,
          onClick: () => void handleOpen(menu.att.id)
        },
        {
          id: 'save',
          label: 'Save attachment…',
          icon: <TrayArrowDown size={14} weight="duotone" />,
          onClick: () => void handleSave(menu.att.id, menu.att.filename)
        },
        ...(attachments.length > 1
          ? [
              { id: 'sep', label: '', separator: true },
              {
                id: 'save-all',
                label: 'Save all attachments…',
                icon: <TrayArrowDown size={14} weight="duotone" />,
                onClick: () => void handleSaveAll()
              }
            ]
          : [])
      ]
    : []

  return (
    <div className="reader-attachments">
      {attachments.map((att) => (
        <div
          key={att.id}
          className="attachment-item"
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setMenu({ x: event.clientX, y: event.clientY, att })
          }}
        >
          <button
            type="button"
            className="attachment-chip"
            disabled={anyBusy}
            onClick={() => void handleOpen(att.id)}
            title="Open attachment"
          >
            <Paperclip size={14} weight="duotone" />
            {busy?.id === att.id && busy.kind === 'open' ? 'Opening…' : att.filename}
            <span style={{ color: 'var(--text-muted)' }}>({formatSize(att.size)})</span>
          </button>
          <button
            type="button"
            className="attachment-save-btn"
            disabled={anyBusy}
            onClick={() => void handleSave(att.id, att.filename)}
            title="Save attachment…"
          >
            <TrayArrowDown size={14} weight="duotone" />
          </button>
        </div>
      ))}
      {attachments.length > 1 && (
        <button
          type="button"
          className="attachment-save-all-btn"
          disabled={anyBusy}
          onClick={() => void handleSaveAll()}
          title="Save all attachments…"
        >
          <TrayArrowDown size={14} weight="duotone" />
          {savingAll ? 'Saving…' : 'Save all'}
        </button>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

// ---- Conversation (thread) reader ----------------------------------------

// "Summarize conversation" — the thread-level sibling of AnalyzeButton. The
// label says what the click will do, because the three states cost different
// things: a first summary and a regeneration both spend tokens, and an update is
// what a stale one needs.
function ThreadSummaryButton({
  accountId,
  threadId
}: {
  accountId: string
  threadId: string
}) {
  const key = expandKey(accountId, threadId)
  const analysis = useMailStore((s) => s.threadAnalysisByKey[key])
  const analyzing = useMailStore((s) => s.analyzingThreadKey === key)

  const label = analyzing
    ? 'Summarizing…'
    : !analysis
      ? 'Summarize'
      : analysis.stale
        ? 'Update summary'
        : 'Re-summarize'

  return (
    <button
      type="button"
      className="reader-ai-btn"
      title="Summarize this conversation with AI"
      disabled={analyzing}
      onClick={() => void analyzeThread(accountId, threadId, !!analysis)}
    >
      <Sparkle size={16} weight="duotone" />
      {label}
    </button>
  )
}

function ThreadView({ messages, threadId }: { messages: MessageDetail[]; threadId: string }) {
  const setToast = useMailStore((s) => s.setToast)
  const latest = messages[messages.length - 1]
  const threadKey = expandKey(latest.accountId, threadId)
  const analysis = useMailStore((s) => s.threadAnalysisByKey[threadKey])
  const summarizing = useMailStore((s) => s.analyzingThreadKey === threadKey)

  const handleReply = () => {
    void window.orbitMail.compose.open({
      accountId: latest.accountId,
      mode: 'reply',
      originalMessageId: latest.id
    })
  }

  const handleReplyAll = () => {
    void window.orbitMail.compose.open({
      accountId: latest.accountId,
      mode: 'reply-all',
      originalMessageId: latest.id
    })
  }

  const handleForward = () => {
    void window.orbitMail.compose.open({
      accountId: latest.accountId,
      mode: 'forward',
      originalMessageId: latest.id
    })
  }

  const handlePrint = async () => {
    try {
      await printThreadDetails(messages)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Print failed')
    }
  }

  return (
    <div>
      <div className="reader-header">
        <div className="reader-header-top">
          <div className="reader-subject">
            {latest.subject}
            {messages.length > 1 && (
              <span className="reader-thread-count">{messages.length} messages</span>
            )}
          </div>
          <div className="reader-header-actions">
            <button
              type="button"
              className="reader-ai-btn primary"
              title="Reply to the latest message"
              onClick={handleReply}
            >
              <ArrowBendUpLeft size={16} weight="duotone" />
              Reply
            </button>
            <button
              type="button"
              className="reader-ai-btn"
              title="Reply to everyone"
              onClick={handleReplyAll}
            >
              <ArrowBendDoubleUpLeft size={16} weight="duotone" />
              Reply All
            </button>
            <button
              type="button"
              className="reader-ai-btn"
              title="Forward the latest message"
              onClick={handleForward}
            >
              <ArrowBendUpRight size={16} weight="duotone" />
              Forward
            </button>
            <button
              type="button"
              className="reader-ai-btn"
              title="Print this conversation"
              onClick={handlePrint}
            >
              <Printer size={16} weight="duotone" />
              Print
            </button>
            <DraftReplyButton messageId={latest.id} />
            <ThreadSummaryButton accountId={latest.accountId} threadId={threadId} />
          </div>
        </div>
      </div>

      {(analysis || summarizing) && (
        <div className="reader-ai-panel">
          <div className="reader-ai-panel-header">
            <Sparkle size={14} weight="fill" />
            <span>Conversation Summary</span>
          </div>
          {summarizing && !analysis ? (
            <div className="reader-ai-loading">Reading this conversation…</div>
          ) : analysis ? (
            <div className="reader-ai-body">
              {/* Say what the summary does and does not cover, rather than
                  letting it read as an account of the whole thread. */}
              {analysis.stale && (
                <p className="reader-ai-note">
                  {analysis.currentMessageCount - analysis.messageCount === 1
                    ? '1 new message has arrived since this summary.'
                    : `${analysis.currentMessageCount - analysis.messageCount} new messages have arrived since this summary.`}
                </p>
              )}
              {analysis.analyzedCount < analysis.messageCount && (
                <p className="reader-ai-note">
                  Covers the first message and the {analysis.analyzedCount - 1} most recent, of{' '}
                  {analysis.messageCount}.
                </p>
              )}
              <p className="reader-ai-summary">{analysis.summary}</p>
              <AiSection title="Decisions" items={analysis.decisions} />
              <AiOwnerSection title="Action Items" items={analysis.actionItems} />
              <AiSection title="Open Questions" items={analysis.openQuestions} />
            </div>
          ) : null}
        </div>
      )}

      <div className="thread-conversation">
        {messages.map((message, i) => (
          <ThreadMessage
            key={message.id}
            message={message}
            defaultExpanded={i === messages.length - 1 || !message.isRead}
          />
        ))}
      </div>
    </div>
  )
}

const ThreadMessage = memo(function ThreadMessage({
  message,
  defaultExpanded
}: {
  message: MessageDetail
  defaultExpanded: boolean
}) {
  const setToast = useMailStore((s) => s.setToast)
  const aiAnalysis = useMailStore((s) => s.aiAnalysisById[message.id])
  const aiAnalyzingId = useMailStore((s) => s.aiAnalyzingId)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const isAnalyzing = aiAnalyzingId === message.id

  const remoteImages = useRemoteImageBlocking(message.id, message.from, message.bodyHtml)
  const sanitizedHtml = useMemo(
    () => sanitizeEmailHtml(message.bodyHtml, { blockRemoteContent: remoteImages.blocked }),
    [message.id, message.bodyHtml, remoteImages.blocked]
  )
  const bodyPaper = useMemo(() => assumesLightBackground(sanitizedHtml), [sanitizedHtml])

  const handleBodyClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest('a')
    if (!anchor) return
    const href = anchor.getAttribute('href')
    if (!href || href.startsWith('#')) return
    event.preventDefault()
    void window.orbitMail.shell.openExternal(href)
  }

  if (!expanded) {
    return (
      <div className="thread-msg" onClick={() => setExpanded(true)}>
        <div className="thread-msg-head">
          <span className="thread-msg-from">{extractName(message.from)}</span>
          <span className="thread-msg-preview">{message.snippet}</span>
          <span className="thread-msg-date">
            {(message.flagColor || message.isStarred) && (
              <Flag
                size={12}
                weight="fill"
                style={{ color: flagColorHex(message.flagColor) ?? '#f5a623' }}
              />
            )}
            {new Date(message.date).toLocaleDateString()}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="thread-msg is-open">
      <div className="thread-msg-head" onClick={() => setExpanded(false)}>
        <div className="thread-msg-head-main">
          <span className="thread-msg-from">{message.from}</span>
          <span className="thread-msg-to">to {message.to}</span>
        </div>
        <div className="thread-msg-head-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`reader-star-btn${message.isStarred ? ' active' : ''}`}
            title={message.isStarred ? 'Remove star' : 'Star message'}
            onClick={() => void toggleThreadMessageStar(message.id, !message.isStarred)}
          >
            <Flag
              size={16}
              weight="fill"
              style={{ color: flagColorHex(message.flagColor) ?? '#f5a623' }}
            />
          </button>
          <AnalyzeButton message={message} iconSize={14} />
          <span className="thread-msg-date">{new Date(message.date).toLocaleString()}</span>
        </div>
      </div>

      <AttachmentList attachments={message.attachments} messageId={message.id} />

      {(aiAnalysis || isAnalyzing) && (
        <div className="reader-ai-panel">
          <div className="reader-ai-panel-header">
            <Sparkle size={14} weight="fill" />
            <span>AI Analysis</span>
          </div>
          {isAnalyzing && !aiAnalysis ? (
            <div className="reader-ai-loading">Analyzing this message…</div>
          ) : aiAnalysis ? (
            <div className="reader-ai-body">
              <p className="reader-ai-summary">{aiAnalysis.summary}</p>
              <AiSection title="Action Items" items={aiAnalysis.actionItems} />
              <AiSection title="Questions" items={aiAnalysis.questions} />
              <AiSection title="Key Context" items={aiAnalysis.keyContext} />
              <AiSkippedAttachments files={aiAnalysis.skippedAttachments} />
            </div>
          ) : null}
        </div>
      )}

      {remoteImages.blocked && (
        <RemoteContentBar
          sender={remoteImages.senderEmail}
          onLoadOnce={remoteImages.loadOnce}
          onAlwaysAllow={remoteImages.alwaysAllow}
        />
      )}
      <div className="reader-body thread-msg-body" onClick={handleBodyClick}>
        {sanitizedHtml ? (
          <div
            className={bodyPaper ? 'email-html-paper' : undefined}
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
          />
        ) : (
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
            {message.bodyText ?? 'No content'}
          </pre>
        )}
      </div>
    </div>
  )
})
