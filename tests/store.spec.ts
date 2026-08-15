import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventStore, type AirbagEvent } from '../src/store.ts'
import { fakeDeepSeekKey } from './helpers.ts'

async function makeStore(): Promise<{ store: EventStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'airbag-store-'))
  return { store: new EventStore(dir), dir }
}

const event: AirbagEvent = {
  ts: new Date().toISOString(),
  kind: 'paste',
  category: 'DeepSeek API Key',
  action: 'blocked',
  direction: 'in',
  masked: 'sk-0***cdef',
  hashPrefix: 'a1b2c3d4e5f6',
  notice: 2,
}

describe('EventStore', () => {
  it('appends and lists newest-first', async () => {
    const { store } = await makeStore()
    await store.append({ ...event, ts: '2026-01-01T00:00:00.000Z' })
    await store.append({ ...event, ts: '2026-01-02T00:00:00.000Z' })
    const list = await store.list()
    expect(list).toHaveLength(2)
    expect(list[0]?.ts).toBe('2026-01-02T00:00:00.000Z')
  })

  it('persists append-only JSONL with masked values only', async () => {
    const { store, dir } = await makeStore()
    await store.append(event)
    const raw = await readFile(join(dir, 'events.jsonl'), 'utf8')
    expect(raw.trim().endsWith('}')).toBe(true)
    expect(raw).not.toContain(fakeDeepSeekKey())
  })

  it('clears real events', async () => {
    const { store } = await makeStore()
    await store.append(event)
    await store.clear()
    expect(await store.list()).toHaveLength(0)
  })

  it('tracks scannedAt from the scan event', async () => {
    const { store } = await makeStore()
    expect(await store.scannedAt()).toBeNull()
    await store.append({ ...event, kind: 'scan', action: 'recorded', direction: 'none', note: 'clean' })
    expect(await store.scannedAt()).not.toBeNull()
  })
})
