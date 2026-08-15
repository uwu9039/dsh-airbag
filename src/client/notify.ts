/**
 * G1 corner notification center. Everything lives in the bottom-right
 * corner (16px margin), never steals focus, never blocks the keyboard, and
 * honors a global do-not-disturb switch.
 *
 * Levels:
 *   0 — nothing (record only)
 *   1 — badge counter only
 *   2 — toast, auto-dismisses after 4s, no sound
 *   3 — toast + persistent badge until the panel is opened
 *   4 — toast + persistent badge (red) — reserved for leak events
 */

export interface NotifyApi {
  /** Raise one notification. */
  toast(notice: number, title: string, detail: string): void
  /** Set the unread badge count (0 hides it). */
  setBadge(count: number, level: number): void
  /** Toggle do-not-disturb (hides toasts and badge pulses). */
  setDnd(dnd: boolean): void
  /** Register the panel toggle (called by the panel owner). */
  onToggle(open: () => void): void
  /** Keep the badge for the panel opener. */
  markOpened(): void
  dispose(): void
}

const CSS = `
[data-airbag-root] {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483000;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.45;
  color: #1f2430;
}
[data-airbag-root] * { box-sizing: border-box; }
@media (prefers-color-scheme: dark) {
  [data-airbag-root] { color: #d6dae3; }
}
[data-airbag-toast] {
  position: absolute;
  right: 0;
  bottom: 52px;
  width: 300px;
  max-width: calc(100vw - 32px);
  background: #ffffff;
  border: 1px solid #e2e5ec;
  border-left: 3px solid #4c7df0;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(20, 30, 60, 0.16);
  padding: 10px 12px;
  margin-bottom: 8px;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.18s ease, transform 0.18s ease;
}
@media (prefers-color-scheme: dark) {
  [data-airbag-toast] { background: #232936; border-color: #343c4d; }
}
[data-airbag-toast].show { opacity: 1; transform: translateY(0); }
[data-airbag-toast][data-level="3"] { border-left-color: #e8a13a; }
[data-airbag-toast][data-level="4"] { border-left-color: #d64545; }
[data-airbag-toast] h4 { margin: 0 0 2px; font-size: 13px; font-weight: 600; }
[data-airbag-toast] p { margin: 0; font-size: 12px; opacity: 0.85; word-break: break-all; }
[data-airbag-close] {
  position: absolute;
  top: 6px;
  right: 8px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
  opacity: 0.5;
  padding: 2px 4px;
}
[data-airbag-close]:hover { opacity: 1; }
[data-airbag-fab] {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #1f2430;
  color: #fff;
  border: none;
  border-radius: 999px;
  padding: 8px 12px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(20, 30, 60, 0.28);
  font-size: 13px;
}
[data-airbag-fab]:hover { background: #2c3342; }
[data-airbag-fab] .airbag-badge {
  min-width: 18px;
  height: 18px;
  border-radius: 999px;
  background: #d64545;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
}
[data-airbag-fab] .airbag-badge[data-level="3"] { background: #e8a13a; }
[data-airbag-fab] .airbag-badge[data-level="4"] { background: #d64545; }
@media (prefers-reduced-motion: reduce) {
  [data-airbag-toast] { transition: none; }
}
`

function injectStyle(owner: HTMLElement, doc: Document): void {
  const id = 'dsh-airbag-css'
  if (doc.querySelector(`style[data-plugin-css="${id}"]`) !== null) return
  const tag = doc.createElement('style')
  tag.dataset.plugin = 'dsh-airbag'
  tag.dataset.pluginCss = id
  tag.textContent = CSS
  doc.head.appendChild(tag)
}

/** Mount the corner notification center. */
export function mountNotify(doc: Document = document): NotifyApi {
  const root = doc.createElement('div')
  root.dataset.airbagRoot = 'true'
  root.setAttribute('aria-live', 'polite')
  injectStyle(root, doc)

  const fab = doc.createElement('button')
  fab.dataset.airbagFab = 'true'
  fab.title = 'AI 安全气囊 · 打开面板'
  fab.innerHTML = '<span aria-hidden="true">🛡️</span><span>Airbag</span>'
  fab.setAttribute('aria-label', 'AI 安全气囊面板')

  const badge = doc.createElement('span')
  badge.className = 'airbag-badge'
  badge.dataset.airbagBadge = 'true'
  badge.hidden = true
  fab.appendChild(badge)

  let dnd = false
  let unread = 0
  let unreadLevel = 0
  let toggleHandler: (() => void) | null = null

  const showToast = (notice: number, title: string, detail: string): void => {
    if (dnd || notice <= 0) return
    const toast = doc.createElement('div')
    toast.dataset.airbagToast = 'true'
    toast.dataset.level = String(Math.min(notice, 4))
    const head = doc.createElement('h4')
    head.textContent = title
    const body = doc.createElement('p')
    body.textContent = detail
    const close = doc.createElement('button')
    close.dataset.airbagClose = 'true'
    close.textContent = '×'
    close.setAttribute('aria-label', '关闭')
    close.addEventListener('click', () => toast.remove())
    toast.append(close, head, body)
    root.appendChild(toast)
    // Reflow then show (transition).
    requestAnimationFrame(() => toast.classList.add('show'))
    if (notice <= 2) {
      window.setTimeout(() => {
        toast.classList.remove('show')
        window.setTimeout(() => toast.remove(), 220)
      }, 4000)
    } else {
      // L3+: keep until closed or panel opened.
      unread += 1
      unreadLevel = Math.max(unreadLevel, notice)
      renderBadge()
    }
  }

  const renderBadge = (): void => {
    if (unread > 0 && !dnd) {
      badge.textContent = String(unread)
      badge.dataset.level = String(unreadLevel)
      badge.hidden = false
    } else {
      badge.hidden = true
    }
  }

  fab.addEventListener('click', () => {
    toggleHandler?.()
  })

  root.append(fab)
  // Never assume <body> exists yet (client plugins can mount before the
  // shell renders); defer to DOMContentLoaded instead of throwing.
  const attach = (): void => {
    if (doc.body === null) {
      doc.addEventListener('DOMContentLoaded', attach, { once: true })
      return
    }
    doc.body.appendChild(root)
  }
  attach()

  return {
    toast: showToast,
    setBadge(count, level) {
      unread = count
      unreadLevel = level
      renderBadge()
    },
    setDnd(value) {
      dnd = value
      renderBadge()
      if (dnd) root.querySelectorAll('[data-airbag-toast]').forEach((t) => t.remove())
    },
    onToggle(handler) {
      toggleHandler = handler
    },
    markOpened() {
      unread = 0
      unreadLevel = 0
      renderBadge()
    },
    dispose() {
      root.remove()
      doc.querySelectorAll(`style[data-plugin="dsh-airbag"]`).forEach((tag) => tag.remove())
    },
  }
}
