/**
 * B approval-fatigue insight: a passive observer of the native approval
 * seam. It never decides — it watches `approval/request` outcomes and
 * derives two signals:
 *
 * - blind-burst: several approvals granted in under the blind threshold
 *   (rubber-stamping) within one session — the approval UI is being
 *   clicked without reading;
 * - fatigue-high: a dense window of approvals with a very high grant rate
 *   — the classic confirmation-fatigue pattern where the safety mechanism
 *   has effectively disabled itself.
 */
export interface ApprovalRecord {
  /** Epoch ms when the request entered the chain. */
  ts: number
  /** Asked → decided duration in ms. */
  durationMs: number
  outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
  toolName: string
  /** Best-effort session identity (agent id); may be undefined. */
  sessionId?: string
}

export type ApprovalInsightKind = 'blind-burst' | 'fatigue-high'

export interface ApprovalInsightEvent {
  kind: ApprovalInsightKind
  at: number
  note: string
}

export interface ApprovalStats {
  total: number
  blind: number
  granted: number
  grantRate: number
  lastMinute: number
}

/** Rolling observer over approval records. */
export class ApprovalTracker {
  private entries: ApprovalRecord[] = []
  private lastFatigueAt = 0
  private lastBlindAt = 0

  constructor(
    private readonly blindThresholdMs = 2_000,
    private readonly blindBurstCount = 3,
    private readonly burstWindowMs = 5 * 60_000,
    private readonly fatigueWindowMs = 30 * 60_000,
    private readonly fatigueMinCount = 15,
    private readonly fatigueMinRate = 0.9,
    private readonly fatigueCooldownMs = 10 * 60_000,
    private readonly maxEntries = 500,
  ) {}

  /** Record one approval outcome; returns any insights it triggered. */
  record(entry: ApprovalRecord): ApprovalInsightEvent[] {
    this.entries.push(entry)
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries)
    }
    const events: ApprovalInsightEvent[] = []

    // Blind burst: >= N grants faster than the threshold within one session
    // and inside the burst window. Throttled so one burst reports once.
    if (entry.ts - this.lastBlindAt > this.burstWindowMs) {
      const blind = this.entries.filter((e) =>
        e.sessionId === entry.sessionId
        && e.outcome === 'allowed-once'
        && e.durationMs < this.blindThresholdMs
        && entry.ts - e.ts <= this.burstWindowMs,
      )
      if (blind.length >= this.blindBurstCount) {
        this.lastBlindAt = entry.ts
        events.push({
          kind: 'blind-burst',
          at: entry.ts,
          note: `会话内 ${blind.length} 次盲批（<${this.blindThresholdMs}ms 内批准，最近：${entry.toolName}）`,
        })
      }
    }

    // Fatigue: dense window with a near-universal grant rate, throttled by
    // a cooldown so the signal does not spam.
    if (entry.ts - this.lastFatigueAt > this.fatigueCooldownMs) {
      const windowed = this.entries.filter((e) => entry.ts - e.ts <= this.fatigueWindowMs)
      if (windowed.length >= this.fatigueMinCount) {
        const granted = windowed.filter((e) => e.outcome === 'allowed-once').length
        if (granted / windowed.length >= this.fatigueMinRate) {
          this.lastFatigueAt = entry.ts
          events.push({
            kind: 'fatigue-high',
            at: entry.ts,
            note: `${Math.round(this.fatigueWindowMs / 60_000)} 分钟内 ${windowed.length} 次审批、批准率 ${Math.round(granted / windowed.length * 100)}%——建议切到 never 策略或暂停任务`,
          })
        }
      }
    }
    return events
  }

  /** Snapshot statistics for the panel (no persistence). */
  stats(now = Date.now()): ApprovalStats {
    const total = this.entries.length
    const granted = this.entries.filter((e) => e.outcome === 'allowed-once').length
    const blind = this.entries.filter((e) => e.outcome === 'allowed-once' && e.durationMs < this.blindThresholdMs).length
    const lastMinute = this.entries.filter((e) => now - e.ts <= 60_000).length
    return {
      total,
      blind,
      granted,
      grantRate: total === 0 ? 0 : granted / total,
      lastMinute,
    }
  }
}
