/**
 * Airbag panel: events / health scan / settings, one floating
 * bottom-right surface. Pure DOM, no framework. Opening the panel marks
 * unread events as read.
 */
import type { AirbagApi, ClientEvent, ClientSettings, ScanFinding } from './api.ts'
import type { NotifyApi } from './notify.ts'

/** localStorage may be unavailable (privacy modes / sandboxed frames): never throw. */
function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // non-fatal: path memory is a convenience, not a requirement
  }
}

export interface PanelHandle {
  open(): void
  close(): void
  toggle(): void
  dispose(): void
}

const PANEL_CSS = `
[data-airbag-panel] {
  position: fixed;
  right: 16px;
  bottom: 64px;
  width: 380px;
  max-width: calc(100vw - 32px);
  max-height: min(560px, calc(100vh - 96px));
  background: #ffffff;
  border: 1px solid #e2e5ec;
  border-radius: 12px;
  box-shadow: 0 12px 36px rgba(20, 30, 60, 0.22);
  display: flex;
  flex-direction: column;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
  color: #1f2430;
  z-index: 2147483001;
  overflow: hidden;
}
@media (prefers-color-scheme: dark) {
  [data-airbag-panel] { background: #232936; border-color: #343c4d; color: #d6dae3; }
}
[data-airbag-panel][hidden] { display: none; }
.airbag-panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #e8eaf0;
  font-weight: 700;
}
@media (prefers-color-scheme: dark) {
  .airbag-panel-head { border-bottom-color: #343c4d; }
}
.airbag-panel-close {
  margin-left: auto;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 16px;
  opacity: 0.55;
  padding: 2px 6px;
}
.airbag-tabs {
  display: flex;
  border-bottom: 1px solid #e8eaf0;
}
@media (prefers-color-scheme: dark) {
  .airbag-tabs { border-bottom-color: #343c4d; }
}
.airbag-tab {
  flex: 1;
  padding: 8px 4px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 13px;
  color: inherit;
  opacity: 0.6;
  border-bottom: 2px solid transparent;
}
.airbag-tab[aria-selected="true"] { opacity: 1; border-bottom-color: #4c7df0; font-weight: 600; }
.airbag-panel-body { flex: 1; overflow-y: auto; padding: 12px; }
.airbag-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px 0;
  border-bottom: 1px solid #f0f1f5;
}
@media (prefers-color-scheme: dark) {
  .airbag-row { border-bottom-color: #2e3544; }
}
.airbag-row:last-child { border-bottom: none; }
.airbag-row .airbag-emoji { font-size: 15px; line-height: 1.3; }
.airbag-row .airbag-meta { font-size: 11px; opacity: 0.6; }
.airbag-muted { opacity: 0.6; font-size: 12px; }
.airbag-field { margin-bottom: 10px; }
.airbag-field label { display: block; font-weight: 600; margin-bottom: 4px; }
.airbag-field input[type="text"], .airbag-field textarea, .airbag-field select {
  width: 100%;
  border: 1px solid #d5d9e2;
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 12px;
  font-family: inherit;
  background: #fff;
  color: inherit;
}
@media (prefers-color-scheme: dark) {
  .airbag-field input[type="text"], .airbag-field textarea, .airbag-field select { background: #1c222d; border-color: #3a4254; }
}
.airbag-field textarea { min-height: 64px; resize: vertical; font-family: ui-monospace, Consolas, monospace; }
.airbag-inline { display: flex; gap: 8px; align-items: center; }
.airbag-btn {
  border: 1px solid #d5d9e2;
  background: #f6f7fa;
  color: inherit;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}
.airbag-btn:hover { background: #eceef4; }
@media (prefers-color-scheme: dark) {
  .airbag-btn { background: #2a3140; border-color: #3a4254; }
  .airbag-btn:hover { background: #333b4d; }
}
.airbag-btn.primary { background: #4c7df0; border-color: #4c7df0; color: #fff; }
.airbag-btn.primary:hover { background: #3d6ae0; }
.airbag-btn.danger { color: #d64545; }
.airbag-finding { display: flex; gap: 8px; padding: 6px 0; font-size: 12px; }
.airbag-finding code { font-family: ui-monospace, Consolas, monospace; font-size: 11px; word-break: break-all; opacity: 0.9; }
.airbag-hint { font-size: 11px; opacity: 0.6; margin-top: 4px; }
`

export interface PanelDeps {
  api: AirbagApi
  notify: NotifyApi
  /** Called after settings save so the paste guard reloads. */
  onSettingsSaved(): void
  /** Current do-not-disturb (kept in sync with settings). */
  isDnd(): boolean
  setDnd(value: boolean): void
}

const KIND_META: Record<string, { emoji: string; label: string }> = {
  paste: { emoji: '🔑', label: '粘贴拦截' },
  write: { emoji: '✍️', label: '写入拦截' },
  leak: { emoji: '⚠️', label: '泄露追踪' },
  approval: { emoji: '🧾', label: '审批洞察' },
  scan: { emoji: '🩺', label: '体检' },
}

const ACTION_META: Record<string, string> = {
  blocked: '已阻止',
  redacted: '已脱敏',
  warned: '已警告',
  recorded: '已记录',
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
  if (text !== undefined) node.textContent = text
  return node
}

/** Create the panel; hidden until open(). */
export function createPanel(deps: PanelDeps, doc: Document = document): PanelHandle {
  const root = el(doc, 'div')
  root.dataset.airbagPanel = 'true'
  root.hidden = true

  // CSS
  const styleId = 'dsh-airbag-panel-css'
  if (doc.querySelector(`style[data-plugin-css="${styleId}"]`) === null) {
    const tag = doc.createElement('style')
    tag.dataset.plugin = 'dsh-airbag'
    tag.dataset.pluginCss = styleId
    tag.textContent = PANEL_CSS
    doc.head.appendChild(tag)
  }

  const head = el(doc, 'div', { class: 'airbag-panel-head' })
  head.append('🛡️ AI 安全气囊')
  const close = el(doc, 'button', { class: 'airbag-panel-close', 'aria-label': '关闭' }, '×')
  head.appendChild(close)

  const tabs = el(doc, 'div', { class: 'airbag-tabs' })
  const tabDefs = [
    { id: 'events', label: '拦截记录' },
    { id: 'scan', label: '体检' },
    { id: 'settings', label: '设置' },
  ] as const
  const bodies = new Map<string, HTMLElement>()
  let activeTab = 'events'

  const tabButtons = tabDefs.map((def) => {
    const button = el(doc, 'button', { class: 'airbag-tab', role: 'tab' }, def.label)
    button.dataset.tab = def.id
    button.setAttribute('aria-selected', String(def.id === activeTab))
    button.addEventListener('click', () => selectTab(def.id))
    tabs.appendChild(button)
    return button
  })

  const body = el(doc, 'div', { class: 'airbag-panel-body' })

  /* ---------------- events tab ---------------- */
  const eventsBody = el(doc, 'div')
  const eventsList = el(doc, 'div')
  const eventsToolbar = el(doc, 'div', { class: 'airbag-inline' })
  const refreshBtn = el(doc, 'button', { class: 'airbag-btn' }, '刷新')
  const clearBtn = el(doc, 'button', { class: 'airbag-btn danger' }, '清空记录')
  eventsToolbar.append(refreshBtn, clearBtn)
  eventsBody.append(eventsToolbar, eventsList)
  bodies.set('events', eventsBody)

  const renderEvents = async (): Promise<void> => {
    const events = await deps.api.events(100).catch(() => [])
    eventsList.textContent = ''
    if (events.length === 0) {
      eventsList.append(el(doc, 'div', { class: 'airbag-muted' }, '暂无拦截记录。粘贴含密钥的内容会被这里记录。'))
      return
    }
    for (const event of events) {
      const meta = KIND_META[event.kind] ?? { emoji: '📋', label: '事件' }
      const row = el(doc, 'div', { class: 'airbag-row' })
      row.append(el(doc, 'span', { class: 'airbag-emoji' }, meta.emoji))
      const main = el(doc, 'div')
      const title = el(doc, 'div', {}, `${ACTION_META[event.action] ?? event.action} · ${meta.label} · ${event.category}`)
      const metaLine = el(doc, 'div', { class: 'airbag-meta' })
      metaLine.textContent = `${formatTime(event.ts)}${event.masked !== undefined ? ` · ${event.masked}` : ''}${event.note !== undefined ? ` · ${event.note}` : ''}`
      main.append(title, metaLine)
      row.appendChild(main)
      eventsList.appendChild(row)
    }
  }

  refreshBtn.addEventListener('click', () => void renderEvents())
  clearBtn.addEventListener('click', () => {
    if (window.confirm('清空全部拦截记录？此操作不可撤销。')) {
      void deps.api.clearEvents().then(() => renderEvents())
    }
  })

  /* ---------------- scan tab ---------------- */
  const scanBody = el(doc, 'div')
  const pathField = el(doc, 'div', { class: 'airbag-field' })
  pathField.append(el(doc, 'label', {}, '工作区路径'))
  const pathInput = el(doc, 'input', { type: 'text', placeholder: '如 D:\\projects\\my-app 或 ~/projects/my-app' })
  pathInput.value = storageGet('dsh-airbag:scan-path') ?? ''
  pathField.appendChild(pathInput)
  const scanBtn = el(doc, 'button', { class: 'airbag-btn primary' }, '开始体检')
  const scanHint = el(doc, 'div', { class: 'airbag-hint' }, '只读扫描 .env / 凭据文件 / 嵌入密钥 / git remote 内嵌凭据；不会读取并保存文件内容。')
  const scanResult = el(doc, 'div')
  scanBody.append(pathField, el(doc, 'div', { class: 'airbag-inline' }, ), scanBtn, scanHint, scanResult)
  scanBody.querySelector('.airbag-inline')?.append(scanBtn)
  bodies.set('scan', scanBody)

  const renderFindings = (findings: ScanFinding[], scanned: boolean): void => {
    scanResult.textContent = ''
    if (!scanned) {
      scanResult.append(el(doc, 'div', { class: 'airbag-muted' }, '尚未扫描。输入路径后点击「开始体检」。'))
      return
    }
    if (findings.length === 0) {
      scanResult.append(el(doc, 'div', {}, '✅ 未发现敏感文件或内嵌凭据。'))
      return
    }
    const kindLabel: Record<string, string> = {
      'env-file': '环境变量文件',
      'credential-file': '凭据文件',
      'embedded-credential': '内嵌凭据',
      'git-remote-credential': 'git remote 内嵌凭据',
    }
    for (const finding of findings) {
      const row = el(doc, 'div', { class: 'airbag-finding' })
      row.append(el(doc, 'span', {}, '⚠️'))
      const main = el(doc, 'div')
      main.append(el(doc, 'div', {}, kindLabel[finding.kind] ?? finding.kind))
      const path = el(doc, 'code', {}, finding.path)
      main.appendChild(path)
      if (finding.category !== undefined) main.append(el(doc, 'div', { class: 'airbag-meta' }, `${finding.category}${finding.masked !== undefined ? ` · ${finding.masked}` : ''}`))
      row.appendChild(main)
      scanResult.appendChild(row)
    }
  }

  scanBtn.addEventListener('click', () => {
    const target = pathInput.value.trim()
    if (target.length === 0) return
    storageSet('dsh-airbag:scan-path', target)
    scanBtn.disabled = true
    scanBtn.textContent = '扫描中…'
    void deps.api.scan(target).then((findings) => {
      renderFindings(findings, true)
      scanBtn.textContent = '开始体检'
      scanBtn.disabled = false
      void deps.notify.toast(1, '体检完成', `发现 ${findings.length} 项（详见体检页）`)
    }).catch((error: unknown) => {
      scanBtn.textContent = '开始体检'
      scanBtn.disabled = false
      scanResult.textContent = ''
      scanResult.append(el(doc, 'div', { class: 'airbag-muted' }, `扫描失败：${error instanceof Error ? error.message : String(error)}`))
    })
  })

  /* ---------------- settings tab ---------------- */
  const settingsBody = el(doc, 'div')
  const form: Array<{ label: string; build: () => HTMLElement }> = []
  const settingValues: {
    defaultAction: HTMLSelectElement
    paste: HTMLSelectElement
    write: HTMLSelectElement
    leak: HTMLSelectElement
    approval: HTMLSelectElement
    scan: HTMLSelectElement
    dnd: HTMLInputElement
    sound: HTMLInputElement
    whitelist: HTMLTextAreaElement
    rules: HTMLTextAreaElement
  } = {} as never

  const levelOptions = (): HTMLSelectElement => {
    const select = el(doc, 'select')
    for (const [value, label] of [[0, '0 不打扰'], [1, '1 仅计数'], [2, '2 轻提示'], [3, '3 需关注'], [4, '4 强提示']] as const) {
      select.append(el(doc, 'option', { value: String(value) }, label))
    }
    return select
  }
  const wrap = (label: string, control: HTMLElement, hint?: string): HTMLElement => {
    const field = el(doc, 'div', { class: 'airbag-field' })
    field.append(el(doc, 'label', {}, label), control)
    if (hint !== undefined) field.append(el(doc, 'div', { class: 'airbag-hint' }, hint))
    return field
  }

  settingValues.defaultAction = el(doc, 'select')
  for (const [value, label] of [['block', '阻止粘贴'], ['redact', '脱敏后粘贴'], ['warn', '仅警告']] as const) {
    settingValues.defaultAction.append(el(doc, 'option', { value }, label))
  }
  form.push({ label: '默认处置（无特殊规则的命中）', build: () => wrap('默认处置', settingValues.defaultAction, '所有级别与处置配置均在本面板设置，拦截提示里不提供现场切换。') })
  settingValues.paste = levelOptions()
  form.push({ label: '粘贴拦截通知级别', build: () => wrap('粘贴拦截通知级别', settingValues.paste) })
  settingValues.write = levelOptions()
  form.push({ label: '写入拦截通知级别', build: () => wrap('写入拦截通知级别', settingValues.write) })
  settingValues.leak = levelOptions()
  form.push({ label: '泄露追踪通知级别', build: () => wrap('泄露追踪通知级别', settingValues.leak) })
  settingValues.approval = levelOptions()
  form.push({ label: '审批洞察通知级别', build: () => wrap('审批洞察通知级别（盲批/疲劳提示）', settingValues.approval) })
  settingValues.scan = levelOptions()
  form.push({ label: '体检结果通知级别', build: () => wrap('体检结果通知级别', settingValues.scan) })
  settingValues.dnd = el(doc, 'input', { type: 'checkbox' })
  form.push({ label: '勿扰模式', build: () => wrap('勿扰模式（隐藏所有浮层与徽章）', settingValues.dnd) })
  settingValues.sound = el(doc, 'input', { type: 'checkbox' })
  form.push({ label: '提示音', build: () => wrap('提示音（L3+ 事件，默认关闭）', settingValues.sound) })
  settingValues.whitelist = el(doc, 'textarea', { placeholder: '每行一个，如：sk-1234' })
  form.push({ label: '白名单（放行片段）', build: () => wrap('白名单（包含即放行）', settingValues.whitelist, '用于故意粘贴的测试 key、示例占位符等。') })
  settingValues.rules = el(doc, 'textarea', { placeholder: '- pattern: INT_[A-Z0-9]{12}\n  label: 内网 Token' })
  const rulesActions = el(doc, 'div', { class: 'airbag-inline' })
  const sampleBtn = el(doc, 'button', { class: 'airbag-btn' }, '插入示例')
  const saveBtn = el(doc, 'button', { class: 'airbag-btn primary' }, '保存设置')
  rulesActions.append(sampleBtn, saveBtn)
  const rulesField = wrap('自定义规则（rules.yaml）', settingValues.rules, 'YAML 列表：pattern / label / action(block|redact|warn) / severity / notice。')
  rulesField.appendChild(rulesActions)
  form.push({ label: '自定义规则', build: () => rulesField })

  for (const item of form) settingsBody.appendChild(item.build())
  bodies.set('settings', settingsBody)

  const fillSettings = (settings: ClientSettings): void => {
    settingValues.defaultAction.value = settings.defaultAction
    settingValues.paste.value = String(settings.noticeLevels.paste)
    settingValues.write.value = String(settings.noticeLevels.write)
    settingValues.leak.value = String(settings.noticeLevels.leak)
    settingValues.approval.value = String(settings.noticeLevels.approval)
    settingValues.scan.value = String(settings.noticeLevels.scan)
    settingValues.dnd.checked = settings.dnd
    settingValues.sound.checked = settings.sound
    settingValues.whitelist.value = settings.whitelist.join('\n')
  }
  const collectSettings = (): ClientSettings => ({
    defaultAction: settingValues.defaultAction.value as ClientSettings['defaultAction'],
    noticeLevels: {
      paste: Number(settingValues.paste.value),
      write: Number(settingValues.write.value),
      leak: Number(settingValues.leak.value),
      approval: Number(settingValues.approval.value),
      scan: Number(settingValues.scan.value),
    },
    dnd: settingValues.dnd.checked,
    sound: settingValues.sound.checked,
    whitelist: settingValues.whitelist.value.split('\n').map((s) => s.trim()).filter((s) => s.length > 0),
  })

  sampleBtn.addEventListener('click', () => {
    void deps.api.rules().then((view) => {
      settingValues.rules.value = view.customYaml.trim().length > 0 ? view.customYaml : view.sampleYaml
    })
  })
  saveBtn.addEventListener('click', () => {
    const settings = collectSettings()
    void deps.api.putConfig(settings).then((saved) => {
      fillSettings(saved)
      deps.setDnd(saved.dnd)
      return deps.api.putRules(settingValues.rules.value)
    }).then(() => {
      deps.onSettingsSaved()
      void deps.notify.toast(1, '设置已保存', '规则与级别已生效')
    }).catch((error: unknown) => {
      void deps.notify.toast(3, '保存失败', error instanceof Error ? error.message : String(error))
    })
  })

  /* ---------------- wiring ---------------- */
  const selectTab = (id: string): void => {
    activeTab = id
    for (const button of tabButtons) {
      button.setAttribute('aria-selected', String(button.dataset.tab === id))
    }
    body.textContent = ''
    body.appendChild(bodies.get(id) ?? eventsBody)
    if (id === 'events') void renderEvents()
    if (id === 'settings') {
      void Promise.all([deps.api.config(), deps.api.rules()]).then(([settings, rules]) => {
        fillSettings(settings)
        settingValues.rules.value = rules.customYaml
      })
    }
    if (id === 'scan') {
      void deps.api.lastScan().then((findings) => renderFindings(findings, true)).catch(() => renderFindings([], false))
    }
  }

  root.append(head, tabs, body)
  close.addEventListener('click', () => closePanel())

  const closePanel = (): void => {
    root.hidden = true
  }
  const openPanel = (): void => {
    root.hidden = false
    deps.notify.markOpened()
    selectTab(activeTab)
  }

  // Never assume <body> exists yet; defer to DOMContentLoaded instead of
  // throwing during early plugin mount.
  const attachPanel = (): void => {
    if (doc.body === null) {
      doc.addEventListener('DOMContentLoaded', attachPanel, { once: true })
      return
    }
    doc.body.appendChild(root)
  }
  attachPanel()

  deps.notify.onToggle(openPanel)

  return {
    open: openPanel,
    close: closePanel,
    toggle() {
      if (root.hidden) openPanel()
      else closePanel()
    },
    dispose() {
      root.remove()
      doc.querySelectorAll(`style[data-plugin="dsh-airbag"]`).forEach((tag) => tag.remove())
    },
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}
