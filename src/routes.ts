/**
 * Airbag HTTP API — the same-origin wire the Web client consumes.
 * Mounts only when the webserver capability is present (non-web profiles
 * skip it). All payloads are JSON; secrets never leave the machine in
 * plaintext (masked fragments + hash prefixes only).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { AirbagEvent } from './store.ts'
import type { ScanFinding } from './scan.ts'
import type { UserSettings } from './config.ts'

/** Route prefix for all airbag endpoints. */
export const API_BASE = '/dsh-airbag/api'

/** Host-side operations the routes call (narrow, structural interface). */
export interface AirbagApi {
  getState(): Promise<StateView>
  listEvents(limit: number): Promise<AirbagEvent[]>
  addEvent(event: Record<string, unknown>): Promise<AirbagEvent>
  clearEvents(): Promise<void>
  scan(workspacePath: string): Promise<ScanFinding[]>
  lastScan(): ScanFinding[] | null
  getRules(): Promise<RulesView>
  putRules(yaml: string): Promise<void>
  getSettings(): Promise<UserSettings>
  putSettings(settings: UserSettings): Promise<UserSettings>
}

export interface StateView {
  enabled: boolean
  scannedAt: string | null
  settings: UserSettings
}

export interface RulesView {
  builtin: Array<{ id: string; label: string; pattern: string; action: string; severity: string; notice: number }>
  custom: Array<{ id: string; label: string; pattern: string; action: string; severity: string; notice: number }>
  whitelist: string[]
  customYaml: string
  sampleYaml: string
}

const MAX_BODY_BYTES = 256 * 1024

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('dsh-airbag: request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', reject)
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

/** The webserver face we consume, narrowed structurally. */
interface WebServerLike {
  register(route: {
    kind: 'exact'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void
  }): () => void
}

function parseLimit(value: string | undefined): number {
  const n = Number(value ?? '100')
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 500) : 100
}

/** Register every airbag endpoint; returns the route disposer. */
export function registerAirbagRoutes(
  ctx: Context,
  api: AirbagApi,
): (() => void) | undefined {
  const server = ctx.get('webServer') as WebServerLike | undefined
  if (server === undefined) return undefined

  const disposers: Array<() => void> = []
  const add = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void): void => {
    disposers.push(server.register({ kind: 'exact', path, handler }))
  }

  add(`${API_BASE}/state`, (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { code: 'method-not-allowed' })
    void api.getState().then((state) => json(res, 200, state)).catch((error) => {
      json(res, 500, { code: 'airbag-error', message: error instanceof Error ? error.message : String(error) })
    })
  })

  add(`${API_BASE}/events`, (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      void api.listEvents(parseLimit(new URL(req.url ?? '/', 'http://localhost').searchParams.get('limit') ?? undefined))
        .then((events) => json(res, 200, { events }))
        .catch(() => json(res, 500, { code: 'airbag-error' }))
      return
    }
    if (req.method === 'POST') {
      void readBody(req).then((text) => {
        const body = JSON.parse(text) as Record<string, unknown>
        if (body.action === 'clear') {
          void api.clearEvents().then(() => json(res, 200, { ok: true }))
          return
        }
        void api.addEvent(body).then((event) => json(res, 200, { event })).catch((error) => {
          json(res, 400, { code: 'event-rejected', message: error instanceof Error ? error.message : String(error) })
        })
      }).catch((error) => json(res, 400, { code: 'bad-request', message: error instanceof Error ? error.message : String(error) }))
      return
    }
    json(res, 405, { code: 'method-not-allowed' })
  })

  add(`${API_BASE}/scan`, (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const last = api.lastScan()
      json(res, 200, { findings: last ?? [], cached: last !== null })
      return
    }
    if (req.method === 'POST') {
      void readBody(req).then(async (text) => {
        const body = JSON.parse(text) as { workspacePath?: unknown }
        if (typeof body.workspacePath !== 'string' || body.workspacePath.length === 0) {
          throw new Error('workspacePath is required')
        }
        const findings = await api.scan(body.workspacePath)
        json(res, 200, { findings, summary: findings.length })
      }).catch((error) => json(res, 400, { code: 'scan-rejected', message: error instanceof Error ? error.message : String(error) }))
      return
    }
    json(res, 405, { code: 'method-not-allowed' })
  })

  add(`${API_BASE}/rules`, (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      void api.getRules().then((view) => json(res, 200, view)).catch(() => json(res, 500, { code: 'airbag-error' }))
      return
    }
    if (req.method === 'PUT') {
      void readBody(req).then(async (text) => {
        const body = JSON.parse(text) as { yaml?: unknown }
        if (typeof body.yaml !== 'string') throw new Error('yaml is required')
        await api.putRules(body.yaml)
        json(res, 200, { ok: true })
      }).catch((error) => json(res, 400, { code: 'rules-rejected', message: error instanceof Error ? error.message : String(error) }))
      return
    }
    json(res, 405, { code: 'method-not-allowed' })
  })

  add(`${API_BASE}/config`, (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      void api.getSettings().then((settings) => json(res, 200, settings)).catch(() => json(res, 500, { code: 'airbag-error' }))
      return
    }
    if (req.method === 'PUT') {
      void readBody(req).then(async (text) => {
        const settings = JSON.parse(text) as UserSettings
        const saved = await api.putSettings(settings)
        json(res, 200, saved)
      }).catch((error) => json(res, 400, { code: 'config-rejected', message: error instanceof Error ? error.message : String(error) }))
      return
    }
    json(res, 405, { code: 'method-not-allowed' })
  })

  ctx.effect(() => {
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-airbag: routes')
  return () => {
    for (const dispose of disposers) dispose()
  }
}
