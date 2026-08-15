import { describe, expect, it } from 'vitest'
import { ApprovalTracker, type ApprovalRecord } from '../src/approval-insight.ts'

const now = 1_800_000_000_000

function grant(over: Partial<ApprovalRecord> & { ts: number }): ApprovalRecord {
  return { durationMs: 500, outcome: 'allowed-once', toolName: 'bash', ...over }
}

describe('ApprovalTracker', () => {
  it('records stats without insights for clean approvals', () => {
    const tracker = new ApprovalTracker()
    tracker.record(grant({ ts: now, durationMs: 5_000 }))
    tracker.record({ ts: now + 1_000, durationMs: 5_000, outcome: 'rejected', toolName: 'bash', sessionId: 's1' })
    const stats = tracker.stats(now + 10_000)
    expect(stats.total).toBe(2)
    expect(stats.granted).toBe(1)
    expect(stats.blind).toBe(0)
    expect(stats.grantRate).toBe(0.5)
  })

  it('flags a blind-burst after 3 fast grants in the same session', () => {
    const tracker = new ApprovalTracker()
    const events: Array<{ kind: string }> = []
    for (let i = 0; i < 3; i += 1) {
      events.push(...tracker.record(grant({ ts: now + i * 500, sessionId: 's1' })))
    }
    expect(events.some((e) => e.kind === 'blind-burst')).toBe(true)
  })

  it('does not flag slow approvals as blind', () => {
    const tracker = new ApprovalTracker()
    for (let i = 0; i < 3; i += 1) {
      tracker.record(grant({ ts: now + i * 500, durationMs: 8_000, sessionId: 's1' }))
    }
    expect(tracker.stats(now + 10_000).blind).toBe(0)
  })

  it('flags fatigue-high on a dense high-grant window, then cools down', () => {
    const tracker = new ApprovalTracker()
    const events: Array<{ kind: string }> = []
    for (let i = 0; i < 15; i += 1) {
      events.push(...tracker.record(grant({ ts: now + i * 1_000, sessionId: 's1' })))
    }
    expect(events.some((e) => e.kind === 'fatigue-high')).toBe(true)
    // Cooldown: another dense batch inside 10 min triggers nothing new.
    const second: Array<{ kind: string }> = []
    for (let i = 0; i < 15; i += 1) {
      second.push(...tracker.record(grant({ ts: now + 120_000 + i * 1_000, sessionId: 's1' })))
    }
    expect(second.some((e) => e.kind === 'fatigue-high')).toBe(false)
  })

  it('does not flag fatigue when grants are sparse or rejected', () => {
    const tracker = new ApprovalTracker()
    for (let i = 0; i < 20; i += 1) {
      tracker.record({
        ts: now + i * 60_000,
        durationMs: 3_000,
        outcome: i % 2 === 0 ? 'allowed-once' : 'rejected',
        toolName: 'write',
        sessionId: 's1',
      })
    }
    expect(tracker.stats(now + 20 * 60_000).grantRate).toBeLessThan(0.9)
  })
})
