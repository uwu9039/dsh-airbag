/**
 * dsh-airbag host plugin.
 *
 * Loader metadata + activation for the safety belt: event store, settings
 * file, workspace health scan, the A2 write-direction guard on
 * the tool pipeline, and the HTTP API the Web client consumes. The paste
 * guard (A1) lives in the Web client.
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { EventStore, type AirbagEvent } from './store.ts'
import { SettingsFile, normalizeSettings, type Config, type UserSettings } from './config.ts'
import { RuleSet, BUILTIN_RULES, hashPrefix, type SecretRule } from './rules.ts'
import { scanWorkspace, summarizeFindings, type ScanFinding } from './scan.ts'
import { registerAirbagRoutes, type AirbagApi, type RulesView, type StateView } from './routes.ts'
import { WRITE_TOOLS, decideWrite, extractWriteText, type PreDecision, type WriteGuardExec } from './write-guard.ts'
import { ApprovalTracker, type ApprovalRecord } from './approval-insight.ts'

export { Config, type Config as AirbagConfig } from './config.ts'
export { BUILTIN_RULES, RuleSet } from './rules.ts'

/** Cordis plugin name (the cordis.patch.yml row id). */
export const name = 'airbag'

/** Required services: the tool pipeline (A2 write guard); webserver is optional. */
export const inject = ['tools']

/** The store/scan/insight operations behind the HTTP API. */
class AirbagImpl implements AirbagApi {
  private lastScanResult: ScanFinding[] | null = null
  private scannedAtCache: string | null | undefined = undefined

  constructor(
    readonly store: EventStore,
    readonly settings: SettingsFile,
    readonly config: Config,
  ) {}

  private async ruleSet(): Promise<RuleSet> {
    const user = await this.settings.read()
    return new RuleSet(BUILTIN_RULES, await this.settings.customRules(), user.whitelist)
  }

  async getState(): Promise<StateView> {
    if (this.scannedAtCache === undefined) {
      this.scannedAtCache = await this.store.scannedAt()
    }
    return {
      enabled: true,
      scannedAt: this.scannedAtCache,
      settings: await this.settings.read(),
    }
  }

  async listEvents(limit: number): Promise<AirbagEvent[]> {
    return this.store.list(limit)
  }

  async addEvent(body: Record<string, unknown>): Promise<AirbagEvent> {
    const kind = body.kind
    if (kind !== 'paste' && kind !== 'write' && kind !== 'leak' && kind !== 'approval' && kind !== 'scan') {
      throw new Error('event.kind must be paste | write | leak | approval | scan')
    }
    const action = body.action
    if (action !== 'blocked' && action !== 'redacted' && action !== 'warned' && action !== 'recorded') {
      throw new Error('event.action must be blocked | redacted | warned | recorded')
    }
    const direction = body.direction
    if (direction !== 'in' && direction !== 'out' && direction !== 'none') {
      throw new Error('event.direction must be in | out | none')
    }
    const category = typeof body.category === 'string' ? body.category.slice(0, 120) : 'unknown'
    const masked = typeof body.masked === 'string' ? body.masked.slice(0, 120) : undefined
    const hashPrefix = typeof body.hashPrefix === 'string' && /^[0-9a-f]{6,16}$/.test(body.hashPrefix)
      ? body.hashPrefix
      : undefined
    const notice = typeof body.notice === 'number' && Number.isInteger(body.notice) && body.notice >= 0 && body.notice <= 4
      ? body.notice
      : undefined
    const event: AirbagEvent = {
      ts: new Date().toISOString(),
      kind,
      category,
      action,
      direction,
      masked,
      hashPrefix,
      notice,
    }
    return this.store.append(event)
  }

  async clearEvents(): Promise<void> {
    await this.store.clear()
  }

  async scan(workspacePath: string): Promise<ScanFinding[]> {
    const root = resolve(workspacePath)
    const info = await stat(root).catch(() => null)
    if (info === null || !info.isDirectory()) {
      throw new Error('workspacePath does not exist or is not a directory')
    }
    // Safety: never scan the whole disk or the user's home root.
    const home = resolve(homedir())
    if (root === resolve(home, '..') || root === home || /^[a-zA-Z]:[\\/]?$/.test(root)) {
      throw new Error('refusing to scan the filesystem root or home directory')
    }
    const rules = await this.ruleSet()
    const findings = await scanWorkspace(root, rules, {
      maxFileBytes: this.config.maxScanFileBytes,
      maxFiles: this.config.maxScanFiles,
    })
    this.lastScanResult = findings
    this.scannedAtCache = new Date().toISOString()
    await this.store.append({
      ts: this.scannedAtCache,
      kind: 'scan',
      category: 'workspace-scan',
      action: 'recorded',
      direction: 'none',
      note: summarizeFindings(findings),
    })
    return findings
  }

  lastScan(): ScanFinding[] | null {
    return this.lastScanResult
  }

  async getRules(): Promise<RulesView> {
    const user = await this.settings.read()
    const custom = await this.settings.customRules()
    const toView = (rule: SecretRule): RulesView['builtin'][number] => ({
      id: rule.id,
      label: rule.label,
      pattern: rule.pattern.source,
      action: rule.action,
      severity: rule.severity,
      notice: rule.notice,
    })
    return {
      builtin: BUILTIN_RULES.map(toView),
      custom: custom.map((entry, index) => ({
        id: `custom-${index + 1}`,
        label: entry.label ?? '自定义规则',
        pattern: entry.pattern,
        action: entry.action ?? 'block',
        severity: entry.severity ?? 'med',
        notice: entry.notice ?? 3,
      })),
      whitelist: user.whitelist,
      customYaml: await this.settings.readRulesYaml(),
      sampleYaml: SettingsFile.sampleRulesYaml(),
    }
  }

  async putRules(yaml: string): Promise<void> {
    await this.settings.writeRulesYaml(yaml)
  }

  async getSettings(): Promise<UserSettings> {
    return this.settings.read()
  }

  async putSettings(settings: UserSettings): Promise<UserSettings> {
    return this.settings.write(normalizeSettings(settings))
  }
}

/** Plugin activation. */
export function apply(ctx: Context, config: Config): void {
  const store = new EventStore(config.dataDir)
  const settings = new SettingsFile(config.dataDir)
  const api = new AirbagImpl(store, settings, config)

  ctx.effect(() => {
    void store.ensure()
    return () => {}
  }, 'dsh-airbag: data')

  // A2 write-direction guard: tools/pre-execute waterfall. The event name and
  // listener shape are structural (dsh-tools is a peer of the host, not of
  // this package); the cast is the boundary with the external event system.
  //
  // Fail-open contract: if airbag itself throws for any reason (storage,
  // settings, hash), the tool call proceeds untouched — the plugin must never
  // break the harness because of its own failure.
  ctx.on('tools/pre-execute' as never, (async (exec: unknown, next: unknown) => {
    const proceed = next as () => Promise<PreDecision>
    try {
      const e = exec as WriteGuardExec
      if (!WRITE_TOOLS.has(e.name)) return proceed()
      const text = extractWriteText(e.arguments)
      if (text.length === 0) return proceed()
      const user = await settings.read()
      const ruleSet = new RuleSet(BUILTIN_RULES, await settings.customRules(), user.whitelist)
      const decision = decideWrite(text, ruleSet)
      if (decision.kind === 'allow' || decision.match === undefined) return proceed()

      const match = decision.match
      // Hash the raw matched text transiently; only the prefix is persisted.
      let prefix: string | undefined
      for (const rule of ruleSet.rules) {
        if (rule.id !== match.ruleId) continue
        const hit = rule.pattern.exec(text)
        if (hit !== null) prefix = await hashPrefix(hit[0])
        break
      }
      const reason = `dsh-airbag: 疑似密钥写入（${match.label}）`
      // Recording is best-effort: a storage failure must not swallow the
      // interception decision (block/ask) itself.
      try {
        await store.append({
          ts: new Date().toISOString(),
          kind: 'write',
          category: match.label,
          action: decision.kind === 'block' ? 'blocked' : 'warned',
          direction: 'out',
          masked: match.masked,
          hashPrefix: prefix,
          notice: user.noticeLevels.write,
        })
        ctx.logger.warn(`[airbag] write interception: ${match.label} via ${e.name} (${decision.kind})`)
      } catch (error) {
        ctx.logger.warn(`[airbag] write interception recorded without event (${decision.kind}): ${String(error)}`)
      }
      if (decision.kind === 'block') {
        return { kind: 'deny', reason }
      }
      return { kind: 'ask', reason: `${reason}，请确认是否继续` }
    } catch (error) {
      // Fail open: airbag's own failure never blocks a tool call.
      ctx.logger.warn(`[airbag] pre-execute observer error, allowing: ${String(error)}`)
      return proceed()
    }
  }) as never)

  // B approval-fatigue observer: a passive, transparent listener on the
  // native approval waterfall. It records asked→decided timing and outcome,
  // then returns the downstream decision untouched — it never decides, and
  // its own failures are swallowed after the decision has been made.
  const tracker = new ApprovalTracker()
  ctx.on('approval/request' as never, (async (req: unknown, next: unknown) => {
    const t0 = Date.now()
    const outcome = await (next as () => Promise<string>)()
    try {
      const record: ApprovalRecord = {
        ts: t0,
        durationMs: Date.now() - t0,
        outcome: outcome as ApprovalRecord['outcome'],
        toolName: ((req as { toolName?: unknown })?.toolName as string | undefined) ?? 'unknown',
        sessionId: ((req as { agent?: { id?: string } })?.agent?.id) ?? undefined,
      }
      const insights = tracker.record(record)
      if (insights.length > 0) {
        const user = await settings.read()
        for (const insight of insights) {
          await store.append({
            ts: new Date(insight.at).toISOString(),
            kind: 'approval',
            category: insight.kind === 'blind-burst' ? '盲批检测' : '疲劳指数',
            action: 'recorded',
            direction: 'none',
            note: insight.note,
            notice: user.noticeLevels.approval,
          })
          ctx.logger.warn(`[airbag] approval insight: ${insight.kind} — ${insight.note}`)
        }
      }
    } catch (error) {
      // Observational only: never fail the approval chain because of airbag.
      ctx.logger.warn(`[airbag] approval observer error (decision kept): ${String(error)}`)
    }
    return outcome
  }) as never)

  // The HTTP API mounts only when the webserver capability exists (web
  // profiles). ctx.inject waits for the service instead of racing the
  // composition order, and unloads the routes when it disappears.
  ctx.inject(['webServer'], (sub) => {
    registerAirbagRoutes(sub, api)
  })
}
