// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientRuleSet, hashPrefix, mountPasteGuard, queryComposer } from '../src/client/paste-guard.ts'
import { mountNotify } from '../src/client/notify.ts'
import type { AirbagApi, ClientRule, ClientSettings } from '../src/client/api.ts'
import { fakeDeepSeekKey } from './helpers.ts'

const RULES: { builtin: ClientRule[]; custom: ClientRule[] } = {
  builtin: [
    { id: 'deepseek-api-key', label: 'DeepSeek API Key', pattern: 'sk-[0-9a-f]{32}', action: 'block', severity: 'high', notice: 3 },
  ],
  custom: [],
}
const SETTINGS: ClientSettings = {
  defaultAction: 'block',
  noticeLevels: { paste: 2, write: 3, leak: 3, approval: 2, scan: 1 },
  dnd: false,
  sound: false,
  whitelist: [],
}

function fakeApi(): AirbagApi {
  return {
    base: '/dsh-airbag/api',
    state: vi.fn(async () => ({ enabled: true, scannedAt: null, settings: SETTINGS })),
    events: vi.fn(async () => []),
    addEvent: vi.fn(async (_event: unknown) => {}),
    clearEvents: vi.fn(async (_event: unknown) => {}),
    scan: vi.fn(async () => []),
    lastScan: vi.fn(async () => []),
    rules: vi.fn(async () => ({ ...RULES, whitelist: [], customYaml: '', sampleYaml: '' })),
    putRules: vi.fn(async (_event: unknown) => {}),
    config: vi.fn(async () => SETTINGS),
    putConfig: vi.fn(async () => SETTINGS),
  } as unknown as AirbagApi
}

function makeComposer(): HTMLElement {
  const root = document.createElement('div')
  root.dataset.composerCard = 'true'
  const textarea = document.createElement('textarea')
  textarea.dataset.phase = 'input'
  root.appendChild(textarea)
  document.body.appendChild(root)
  return textarea
}

function pasteInto(target: HTMLElement, text: string): boolean {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (kind: string) => (kind === 'text/plain' ? text : '') },
  })
  target.dispatchEvent(event)
  return !event.defaultPrevented
}

let cleanup: Array<() => void> = []

afterEach(() => {
  for (const fn of cleanup) fn()
  cleanup = []
  document.body.innerHTML = ''
})

describe('ClientRuleSet', () => {
  it('matches rules and whitelist', () => {
    const set = new ClientRuleSet(RULES.builtin, [])
    expect(set.scan(fakeDeepSeekKey())).not.toBeNull()
    const whitelisted = new ClientRuleSet(RULES.builtin, ['sk-0123'])
    expect(whitelisted.scan(fakeDeepSeekKey())).toBeNull()
  })
})

describe('queryComposer', () => {
  it('finds the real DSH composer DOM (data-composer-card + data-phase)', () => {
    makeComposer()
    expect(queryComposer(document)).not.toBeNull()
  })
})

describe('mountPasteGuard', () => {
  beforeEach(() => {
    makeComposer()
  })

  it('blocks a secret paste into the composer and records an event', async () => {
    const api = fakeApi()
    const notify = vi.fn()
    const record = vi.fn(async (_event: unknown) => {})
    const guard = mountPasteGuard(api, { notify, record })
    cleanup.push(guard.dispose)
    // wait for rules load
    await new Promise((r) => setTimeout(r, 10))

    const textarea = document.querySelector('textarea')!
    const allowed = pasteInto(textarea, 'my key is ' + fakeDeepSeekKey())
    expect(allowed).toBe(false)
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1))
    const recorded = (record.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(recorded.action).toBe('blocked')
    expect(recorded.direction).toBe('in')
    expect(recorded.category).toBe('DeepSeek API Key')
    expect(notify).toHaveBeenCalledWith(2, expect.stringContaining('阻止'), expect.any(String))
  })

  it('stops propagation so the composer paste handler never sees the secret', async () => {
    const api = fakeApi()
    const guard = mountPasteGuard(api, { notify: vi.fn(), record: vi.fn(async () => {}) })
    cleanup.push(guard.dispose)
    await new Promise((r) => setTimeout(r, 10))
    // Runtime-constructed so the literal never appears in this source file.
    const key = `sk-${'0123456789abcdef0123456789abcdef'}`

    const textarea = document.querySelector('textarea')!
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (kind: string) => (kind === 'text/plain' ? key : '') },
    })
    const stopPropagation = vi.spyOn(event, 'stopPropagation')
    textarea.dispatchEvent(event)
    expect(stopPropagation).toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('scrubs the secret if the composer inserts it through another path', async () => {
    const api = fakeApi()
    const key = `sk-${'0123456789abcdef0123456789abcdef'}`
    // A document-level listener registered BEFORE the guard simulates a
    // composer that inserts pasted text despite the cancelled event
    // (same-node listeners still run after stopPropagation).
    const insert = (e: Event): void => {
      const textarea = document.querySelector('textarea')
      if (textarea !== null) (textarea as HTMLTextAreaElement).value = key
    }
    document.addEventListener('paste', insert, true)
    const guard = mountPasteGuard(api, { notify: vi.fn(), record: vi.fn(async () => {}) })
    cleanup.push(guard.dispose)
    await new Promise((r) => setTimeout(r, 10))

    const textarea = document.querySelector('textarea')!
    const allowed = pasteInto(textarea, key)
    expect(allowed).toBe(false)
    expect(textarea.value).not.toContain('sk-')
  })

  it('does not intercept pastes outside the composer', async () => {
    const api = fakeApi()
    const notify = vi.fn()
    const record = vi.fn(async (_event: unknown) => {})
    const guard = mountPasteGuard(api, { notify, record })
    cleanup.push(guard.dispose)
    await new Promise((r) => setTimeout(r, 10))

    const outside = document.createElement('input')
    document.body.appendChild(outside)
    const allowed = pasteInto(outside, fakeDeepSeekKey())
    expect(allowed).toBe(true)
    expect(record).not.toHaveBeenCalled()
  })

  it('lets whitelisted content through', async () => {
    const api = fakeApi()
    const rules = { builtin: RULES.builtin, custom: [], whitelist: ['sk-0123'], customYaml: '', sampleYaml: '' }
    vi.mocked(api.rules).mockResolvedValue(rules)
    vi.mocked(api.config).mockResolvedValue({ ...SETTINGS, whitelist: ['sk-0123'] })
    const record = vi.fn(async (_event: unknown) => {})
    const guard = mountPasteGuard(api, { notify: vi.fn(), record })
    cleanup.push(guard.dispose)
    await new Promise((r) => setTimeout(r, 10))

    const textarea = document.querySelector('textarea')!
    const allowed = pasteInto(textarea, fakeDeepSeekKey())
    expect(allowed).toBe(true)
    expect(record).not.toHaveBeenCalled()
  })

  it('fails open when no composer exists', async () => {
    document.body.innerHTML = ''
    const api = fakeApi()
    const record = vi.fn(async (_event: unknown) => {})
    const guard = mountPasteGuard(api, { notify: vi.fn(), record })
    cleanup.push(guard.dispose)
    await new Promise((r) => setTimeout(r, 10))

    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    const allowed = pasteInto(textarea, fakeDeepSeekKey())
    expect(allowed).toBe(true)
    expect(record).not.toHaveBeenCalled()
  })
})

describe('hashPrefix', () => {
  it('hashes to 12 hex chars', async () => {
    expect(await hashPrefix(fakeDeepSeekKey())).toMatch(/^[0-9a-f]{12}$/)
  })
})

describe('mountNotify', () => {
  it('shows a toast for L2 and auto-removes it', async () => {
    vi.useFakeTimers()
    const notify = mountNotify(document)
    cleanup.push(notify.dispose)
    notify.toast(2, '已阻止粘贴', 'DeepSeek API Key')
    expect(document.querySelector('[data-airbag-toast]')).not.toBeNull()
    vi.advanceTimersByTime(4500)
    expect(document.querySelector('[data-airbag-toast]')).toBeNull()
    vi.useRealTimers()
  })

  it('keeps L3 toasts and counts them in the badge until opened', () => {
    const notify = mountNotify(document)
    cleanup.push(notify.dispose)
    notify.toast(3, '泄露追踪', 'GitHub Token')
    expect(document.querySelector('[data-airbag-badge]')?.textContent).toBe('1')
    notify.markOpened()
    expect((document.querySelector('[data-airbag-badge]') as HTMLElement | null)?.hidden).toBe(true)
  })

  it('hides everything under do-not-disturb', () => {
    const notify = mountNotify(document)
    cleanup.push(notify.dispose)
    notify.setDnd(true)
    notify.toast(3, 'x', 'y')
    expect(document.querySelector('[data-airbag-toast]')).toBeNull()
  })
})

