/**
 * Airbag event store: append-only JSONL under the airbag data directory.
 *
 * Privacy contract: only masked fragments and hash prefixes are ever
 * persisted — never plaintext secrets, never full command lines.
 */
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** One recorded airbag event. */
export interface AirbagEvent {
  /** ISO timestamp. */
  ts: string
  /** Event family. */
  kind: 'paste' | 'write' | 'leak' | 'approval' | 'scan'
  /** Human label of the matched rule, e.g. "DeepSeek API Key". */
  category: string
  /** What the guard did. */
  action: 'blocked' | 'redacted' | 'warned' | 'recorded'
  /** Which direction the secret was moving. */
  direction: 'in' | 'out' | 'none'
  /** Masked fragment (first4***last4), safe to display. */
  masked?: string
  /** SHA-256 prefix of the matched secret (12 hex chars). */
  hashPrefix?: string
  /** Notice level the event was shown at. */
  notice?: number
  /** Free-form note (e.g. scan summary), never containing secrets. */
  note?: string
}

const EVENT_LINE = /^\{.*\}$/

/** One airbag data directory: real events + config + rules. */
export class EventStore {
  readonly dir: string
  readonly eventsFile: string

  constructor(dir: string) {
    this.dir = dir
    this.eventsFile = join(dir, 'events.jsonl')
  }

  async ensure(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
  }

  /** Append one event and return it. */
  async append(event: AirbagEvent): Promise<AirbagEvent> {
    await this.ensure()
    await appendFile(this.eventsFile, `${JSON.stringify(event)}\n`, 'utf8')
    return event
  }

  /** Read the most recent `limit` events (newest first). */
  async list(limit = 200): Promise<AirbagEvent[]> {
    await this.ensure()
    const text = await readFile(this.eventsFile, 'utf8').catch(() => '')
    const events: AirbagEvent[] = []
    for (const line of text.split('\n')) {
      if (!EVENT_LINE.test(line)) continue
      try {
        events.push(JSON.parse(line) as AirbagEvent)
      } catch {
        // skip malformed lines — the file stays append-only
      }
    }
    return events.slice(-limit).reverse()
  }

  /** Count events recorded since an ISO timestamp (today's unread badge). */
  async countSince(iso: string): Promise<number> {
    const events = await this.list(1000)
    return events.filter((e) => e.ts >= iso).length
  }

  /** Remove all real events. */
  async clear(): Promise<void> {
    await this.ensure()
    if (existsSync(this.eventsFile)) await rm(this.eventsFile)
  }

  /** Whether a first-run health scan has ever completed. */
  async scannedAt(): Promise<string | null> {
    const events = await this.list(1000)
    const scan = events.find((e) => e.kind === 'scan')
    return scan?.ts ?? null
  }
}
