/**
 * Client-side fetch wrapper for the airbag host API (same-origin).
 * All wire payloads carry masked fragments + hash prefixes only.
 */

export interface ClientRule {
  id: string
  label: string
  pattern: string
  action: 'block' | 'redact' | 'warn'
  severity: 'low' | 'med' | 'high'
  notice: number
}

export interface ClientSettings {
  defaultAction: 'block' | 'redact' | 'warn'
  noticeLevels: { paste: number; write: number; leak: number; approval: number; scan: number }
  dnd: boolean
  sound: boolean
  whitelist: string[]
}

export interface ClientState {
  enabled: boolean
  scannedAt: string | null
  settings: ClientSettings
}

export interface ClientEvent {
  ts: string
  kind: 'paste' | 'write' | 'leak' | 'approval' | 'scan'
  category: string
  action: 'blocked' | 'redacted' | 'warned' | 'recorded'
  direction: 'in' | 'out' | 'none'
  masked?: string
  hashPrefix?: string
  notice?: number
  note?: string
}

export interface RulesView {
  builtin: ClientRule[]
  custom: ClientRule[]
  whitelist: string[]
  customYaml: string
  sampleYaml: string
}

export interface ScanFinding {
  path: string
  kind: 'env-file' | 'credential-file' | 'embedded-credential' | 'git-remote-credential'
  category?: string
  masked?: string
}

export class AirbagApi {
  constructor(readonly base = '/dsh-airbag/api') {}

  async state(): Promise<ClientState> {
    return this.get('/state')
  }

  async events(limit = 100): Promise<ClientEvent[]> {
    const body = await this.get(`/events?limit=${limit}`)
    return body.events as ClientEvent[]
  }

  async addEvent(event: Omit<ClientEvent, 'ts'>): Promise<void> {
    await this.post('/events', event)
  }

  async clearEvents(): Promise<void> {
    await this.post('/events', { action: 'clear' })
  }

  async scan(workspacePath: string): Promise<ScanFinding[]> {
    const body = await this.post('/scan', { workspacePath })
    return body.findings as ScanFinding[]
  }

  async lastScan(): Promise<ScanFinding[]> {
    const body = await this.get('/scan')
    return body.findings as ScanFinding[]
  }

  async rules(): Promise<RulesView> {
    return this.get('/rules')
  }

  async putRules(yaml: string): Promise<void> {
    await this.put('/rules', { yaml })
  }

  async config(): Promise<ClientSettings> {
    return this.get('/config')
  }

  async putConfig(settings: ClientSettings): Promise<ClientSettings> {
    return this.put('/config', settings)
  }

  private async get(path: string): Promise<any> {
    const res = await fetch(`${this.base}${path}`, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`airbag api ${path}: HTTP ${res.status}`)
    return res.json()
  }

  private async post(path: string, body: unknown): Promise<any> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`airbag api ${path}: HTTP ${res.status}`)
    return res.json()
  }

  private async put(path: string, body: unknown): Promise<any> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`airbag api ${path}: HTTP ${res.status}`)
    return res.json()
  }

  private async delete(path: string): Promise<void> {
    const res = await fetch(`${this.base}${path}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`airbag api ${path}: HTTP ${res.status}`)
  }
}
