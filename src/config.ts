/**
 * Host-side runtime configuration for dsh-airbag.
 *
 * The cordis.yml `Config` schema carries deployment-level defaults; the
 * per-user editable subset lives in `<dataDir>/config.json` (written by the
 * Web settings panel, hot-reloaded on every read). Rules live in
 * `<dataDir>/rules.yaml` (custom regex rules, human-editable) and whitelist
 * entries live in `config.json`.
 */
import { readFile, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { load as loadYaml, dump as dumpYaml } from 'js-yaml'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { CustomRuleEntry } from './rules.ts'

/** Resolve the airbag data directory (DSH_HOME aware). */
export function defaultDataDir(): string {
  const dshHome = process.env.DSH_HOME
  const base = dshHome !== undefined && dshHome.length > 0
    ? dshHome
    : join(homedir(), '.dsh')
  return join(base, 'airbag')
}

/** Deployment-level plugin configuration (cordis.yml row). */
export interface Config {
  /** Where airbag keeps its data (events, config.json, rules.yaml). */
  dataDir: string
  /** Default paste-direction action for rules that do not specify one. */
  defaultAction: 'block' | 'redact' | 'warn'
  /** Max bytes of pasted text scanned synchronously. */
  maxPasteBytes: number
  /** Max bytes per file during the workspace health scan. */
  maxScanFileBytes: number
  /** Max files content-scanned during one health scan. */
  maxScanFiles: number
}

export const Config: Schema<Config> = Schema.object({
  dataDir: Schema.string().default(defaultDataDir()),
  defaultAction: Schema.union(['block', 'redact', 'warn']).default('block'),
  maxPasteBytes: Schema.number().default(10 * 1024),
  maxScanFileBytes: Schema.number().default(256 * 1024),
  maxScanFiles: Schema.number().default(200),
})

/** Per-event notice level overrides (0..4). */
export interface NoticeLevels {
  paste: number
  write: number
  leak: number
  approval: number
  scan: number
}

/** The user-editable runtime settings (config.json). */
export interface UserSettings {
  /** Paste-direction default action for rule hits. */
  defaultAction: 'block' | 'redact' | 'warn'
  /** Per-event-family notice levels. */
  noticeLevels: NoticeLevels
  /** Global do-not-disturb: no toasts, no badge pulses. */
  dnd: boolean
  /** Play a short sound on L3+ events. */
  sound: boolean
  /** Whitelist substrings (plain match). */
  whitelist: string[]
}

export const DEFAULT_SETTINGS: UserSettings = {
  defaultAction: 'block',
  noticeLevels: { paste: 2, write: 3, leak: 3, approval: 2, scan: 1 },
  dnd: false,
  sound: false,
  whitelist: [],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampNotice(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4
    ? value
    : fallback
}

/** Merge a parsed config.json into defaults (schema-lite validation). */
export function normalizeSettings(value: unknown): UserSettings {
  const base: UserSettings = {
    ...DEFAULT_SETTINGS,
    noticeLevels: { ...DEFAULT_SETTINGS.noticeLevels },
  }
  if (!isRecord(value)) return base
  if (value.defaultAction === 'block' || value.defaultAction === 'redact' || value.defaultAction === 'warn') {
    base.defaultAction = value.defaultAction
  }
  if (isRecord(value.noticeLevels)) {
    base.noticeLevels.paste = clampNotice(value.noticeLevels.paste, base.noticeLevels.paste)
    base.noticeLevels.write = clampNotice(value.noticeLevels.write, base.noticeLevels.write)
    base.noticeLevels.leak = clampNotice(value.noticeLevels.leak, base.noticeLevels.leak)
    base.noticeLevels.approval = clampNotice(value.noticeLevels.approval, base.noticeLevels.approval)
    base.noticeLevels.scan = clampNotice(value.noticeLevels.scan, base.noticeLevels.scan)
  }
  if (typeof value.dnd === 'boolean') base.dnd = value.dnd
  if (typeof value.sound === 'boolean') base.sound = value.sound
  if (Array.isArray(value.whitelist)) {
    base.whitelist = value.whitelist.filter((w): w is string => typeof w === 'string')
  }
  return base
}

/** Parse custom rules from a YAML file. Loud on malformed content. */
export function parseCustomRules(yaml: string): CustomRuleEntry[] {
  const parsed = loadYaml(yaml)
  if (parsed === undefined || parsed === null) return []
  if (!Array.isArray(parsed)) {
    throw new Error('rules.yaml must be a YAML list of rule entries')
  }
  const rules: CustomRuleEntry[] = []
  for (const entry of parsed) {
    if (!isRecord(entry)) throw new Error('rules.yaml entries must be objects')
    if (typeof entry.pattern !== 'string' || entry.pattern.length === 0) {
      throw new Error('rules.yaml entries require a non-empty `pattern` string')
    }
    const rule: CustomRuleEntry = {
      pattern: entry.pattern,
      label: typeof entry.label === 'string' && entry.label.length > 0 ? entry.label : '自定义规则',
      action: entry.action === 'block' || entry.action === 'redact' || entry.action === 'warn'
        ? entry.action
        : 'block',
      severity: entry.severity === 'low' || entry.severity === 'med' || entry.severity === 'high'
        ? entry.severity
        : 'med',
      notice: typeof entry.notice === 'number' && Number.isInteger(entry.notice) && entry.notice >= 0 && entry.notice <= 4
        ? entry.notice
        : 3,
    }
    rules.push(rule)
  }
  return rules
}

/** The host-side settings surface: read/write config.json + rules.yaml. */
export class SettingsFile {
  readonly configPath: string
  readonly rulesPath: string
  private cached: UserSettings | null = null
  private cachedMtimeMs = 0

  constructor(readonly dataDir: string) {
    this.configPath = join(dataDir, 'config.json')
    this.rulesPath = join(dataDir, 'rules.yaml')
  }

  async read(): Promise<UserSettings> {
    // mtime-based cache: external edits to config.json are picked up without
    // paying a file read on every scan.
    const info = await stat(this.configPath).catch(() => null)
    const mtime = info?.mtimeMs ?? 0
    if (this.cached !== null && mtime === this.cachedMtimeMs) return this.cached
    this.cachedMtimeMs = mtime
    if (existsSync(this.configPath)) {
      const text = await readFile(this.configPath, 'utf8').catch(() => null)
      if (text !== null) {
        try {
          this.cached = normalizeSettings(JSON.parse(text))
          return this.cached
        } catch {
          // malformed user config: fall through to defaults, keep defaults cached
        }
      }
    }
    this.cached = { ...DEFAULT_SETTINGS, noticeLevels: { ...DEFAULT_SETTINGS.noticeLevels } }
    return this.cached
  }

  /** Persist the full settings object (whitelist included) and refresh cache. */
  async write(settings: UserSettings): Promise<UserSettings> {
    const normalized = normalizeSettings(settings)
    await writeFile(this.configPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
    this.cached = normalized
    this.cachedMtimeMs = await stat(this.configPath).then((s) => s.mtimeMs).catch(() => 0)
    return normalized
  }

  /** Merge a partial patch and persist. */
  async patch(patch: Partial<UserSettings>): Promise<UserSettings> {
    const next = await this.read()
    const merged: UserSettings = {
      ...next,
      ...patch,
      noticeLevels: { ...next.noticeLevels, ...(patch.noticeLevels ?? {}) },
    }
    await this.write(merged)
    return merged
  }

  async readRulesYaml(): Promise<string> {
    if (!existsSync(this.rulesPath)) return ''
    return readFile(this.rulesPath, 'utf8').catch(() => '')
  }

  async writeRulesYaml(content: string): Promise<void> {
    // Validate before persisting: loud failures only.
    if (content.trim().length > 0) parseCustomRules(content)
    await writeFile(this.rulesPath, content, 'utf8')
  }

  /** Current custom rules (built for matching on every scan). */
  async customRules(): Promise<CustomRuleEntry[]> {
    const yaml = await this.readRulesYaml()
    if (yaml.trim().length === 0) return []
    return parseCustomRules(yaml)
  }

  /** Sample custom-rules YAML for the settings panel. */
  static sampleRulesYaml(): string {
    return dumpYaml([
      { pattern: 'INT_[A-Z0-9]{12}', label: '内网 Token', action: 'block', severity: 'high', notice: 3 },
      { pattern: 'prod\\\\.internal', label: '生产主机名', action: 'warn', severity: 'med', notice: 2 },
    ])
  }
}

/** Cordis helper: resolve the settings file from ctx + config. */
export function resolveSettingsFile(ctx: Context, config: Config): SettingsFile {
  return new SettingsFile(config.dataDir)
}
