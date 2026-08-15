/**
 * A1 paste guard: intercepts pastes into the composer and blocks / redacts /
 * warns on secret patterns, per user-configured rules. Decisions happen
 * synchronously inside the paste event (preventDefault must be in-loop);
 * rule tables are fetched from the host and cached.
 *
 * Non-intrusive contract: never steals focus, never blocks the keyboard,
 * never touches content outside the composer. When the composer cannot be
 * located, the guard fails open (no interception) rather than risk breaking
 * unrelated inputs.
 */
import type { AirbagApi, ClientRule, ClientSettings } from './api.ts'

export interface PasteMatch {
  rule: ClientRule
  masked: string
  raw: string
}

/** A compiled client-side rule table (builtin + custom + whitelist). */
export class ClientRuleSet {
  private readonly compiled: Array<{ rule: ClientRule; regex: RegExp }>

  constructor(
    rules: ClientRule[],
    readonly whitelist: string[],
  ) {
    this.compiled = rules
      .filter((rule) => rule.pattern.length > 0)
      .map((rule) => ({ rule, regex: new RegExp(rule.pattern) }))
  }

  isWhitelisted(text: string): boolean {
    return this.whitelist.some((entry) => entry.length > 0 && text.includes(entry))
  }

  /** First rule hit in rule order; whitelisted text yields null. */
  scan(text: string): PasteMatch | null {
    if (text.length === 0 || this.isWhitelisted(text)) return null
    for (const { rule, regex } of this.compiled) {
      const hit = regex.exec(text)
      if (hit === null) continue
      const raw = hit[0]
      return {
        rule,
        raw,
        masked: raw.length <= 12 ? `${raw.slice(0, 2)}***` : `${raw.slice(0, 4)}***${raw.slice(-4)}`,
      }
    }
    return null
  }
}

/** SHA-256 hex prefix (12 chars) — never the plaintext. */
export async function hashPrefix(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).slice(0, 6)
    .map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface PasteGuardCallbacks {
  /** Raise one notification (level 0..4). */
  notify(notice: number, title: string, detail: string): void
  /** Record an interception event on the host. */
  record(event: {
    kind: 'paste'
    category: string
    action: 'blocked' | 'redacted' | 'warned'
    direction: 'in'
    masked: string
    hashPrefix: string
    notice: number
  }): Promise<void>
}

/** Where the user types messages. Mirrors the DSH Web composer DOM
 * (`data-composer-card` container + `data-phase` textarea, verified against
 * the shipped dsh-client-ui-conversation bundle). */
const COMPOSER_SELECTORS = [
  '[data-composer-card]',
  'textarea[data-phase]',
  '[data-slot="composer"]',
  '[data-testid="composer"]',
  '[class*="composer" i]',
]

function isInside(node: Node | null, root: Element): boolean {
  return node !== null && (node === root || root.contains(node))
}

function findEditable(root: Element): HTMLElement | null {
  const editable = root.querySelector<HTMLElement>('textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')
  return editable
}

/** Locate the composer editing surface; returns null when unknown. */
export function queryComposer(doc: Document = document): HTMLElement | null {
  for (const selector of COMPOSER_SELECTORS) {
    const matched = doc.querySelector<HTMLElement>(selector)
    if (matched === null) continue
    // A selector that names the input itself wins; otherwise look inside.
    if (matched.tagName === 'TEXTAREA' || matched.isContentEditable) return matched
    const editable = findEditable(matched)
    if (editable !== null) return editable
  }
  // Fallback: a large contenteditable in the main column.
  const main = doc.querySelector<HTMLElement>('main')
  const candidate = main?.querySelector<HTMLElement>('[contenteditable="true"], textarea')
  return candidate ?? null
}

export interface PasteGuardOptions {
  /** Max bytes of pasted text scanned. */
  maxBytes: number
  /** How many identical interceptions within 5 minutes collapse to one toast. */
  aggregateWindowMs: number
}

const DEFAULT_OPTIONS: PasteGuardOptions = {
  maxBytes: 10 * 1024,
  aggregateWindowMs: 5 * 60 * 1000,
}

export interface PasteGuardHandle {
  dispose(): void
  /** Re-fetch rule table and settings (called on panel save). */
  refresh(): Promise<void>
  /** Current cached settings. */
  settings(): ClientSettings | null
}

/**
 * Remove a matched raw secret from the composer's current content. Best-effort
 * defence-in-depth: the primary interception is preventDefault + stopPropagation
 * at the document capture phase; this covers any future shell path that inserts
 * pasted text regardless of the cancelled event.
 */
function scrubComposer(editable: HTMLElement, raw: string): void {
  if (raw.length === 0) return
  if (editable instanceof HTMLTextAreaElement) {
    if (editable.value.includes(raw)) {
      const caret = Math.max(0, editable.selectionStart - raw.length)
      editable.value = editable.value.replace(raw, '')
      editable.setSelectionRange(caret, caret)
    }
    return
  }
  // contenteditable fallback: strip the raw text from matching text nodes.
  const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode()) !== null) {
    const text = node as Text
    if (text.data.includes(raw)) {
      text.data = text.data.replace(raw, '')
      break
    }
  }
}

/**
 * Mount the paste guard. Returns a handle; call dispose() on unload.
 */
export function mountPasteGuard(
  api: AirbagApi,
  callbacks: PasteGuardCallbacks,
  options: PasteGuardOptions = DEFAULT_OPTIONS,
): PasteGuardHandle {
  let ruleSet: ClientRuleSet | null = null
  let settings: ClientSettings | null = null
  // Aggregation window: (ruleId -> last toast ts) per 5-minute bucket.
  const lastToast = new Map<string, number>()

  const load = async (): Promise<void> => {
    const [rules, config] = await Promise.all([api.rules(), api.config()])
    ruleSet = new ClientRuleSet([...rules.builtin, ...rules.custom], config.whitelist)
    settings = config
  }

  const onPaste = (event: Event): void => {
    if (ruleSet === null || settings === null) return
    const composer = queryComposer()
    if (composer === null) return // fail open: no composer, no interception
    const target = event.target as Node | null
    if (!isInside(target, composer)) return
    const clipboard = (event as ClipboardEvent).clipboardData
    const text = clipboard?.getData('text/plain') ?? ''
    if (text.length === 0) return
    const scanned = text.length > options.maxBytes ? text.slice(0, options.maxBytes) : text
    const match = ruleSet.scan(scanned)
    if (match === null) return

    const action = match.rule.action === 'block' ? settings.defaultAction : match.rule.action
    // Placeholder look-alikes never hard-block.
    const effective = match.rule.id === 'placeholder-secret' && action === 'block' ? 'warn' : action
    const notice = settings.noticeLevels.paste

    if (effective === 'block' || effective === 'redact') {
      event.preventDefault()
      // The DSH composer is a React-controlled textarea whose own onPaste
      // handler reads the clipboard and inserts the text manually — it does
      // not honour defaultPrevented. Stopping propagation at the document
      // capture phase keeps the event from ever reaching React's delegated
      // listener, so the composer's draft state is never touched.
      event.stopPropagation()
      if (effective === 'redact') {
        void navigator.clipboard?.writeText(`[REDACTED:${match.rule.label}]`).catch(() => {})
      }
      // Defensive scrub: if the composer still received the text by some
      // other path (future shell change), remove the raw secret immediately.
      scrubComposer(composer, match.raw)
    }
    void hashPrefix(match.raw).then((prefix) => {
      const recordedAction = effective === 'block' ? 'blocked' : effective === 'redact' ? 'redacted' : 'warned'
      void callbacks.record({
        kind: 'paste',
        category: match.rule.label,
        action: recordedAction,
        direction: 'in',
        masked: match.masked,
        hashPrefix: prefix,
        notice,
      }).catch(() => {})
    })

    const now = Date.now()
    const last = lastToast.get(match.rule.id) ?? 0
    if (now - last > options.aggregateWindowMs) {
      lastToast.set(match.rule.id, now)
      const verb = effective === 'block' ? '已阻止粘贴' : effective === 'redact' ? '已脱敏粘贴' : '检测到疑似密钥'
      callbacks.notify(notice, verb, `${match.rule.label}（${match.masked}）`)
    }
  }

  document.addEventListener('paste', onPaste, true)
  void load()

  return {
    dispose() {
      document.removeEventListener('paste', onPaste, true)
    },
    refresh() {
      return load()
    },
    settings() {
      return settings
    },
  }
}
