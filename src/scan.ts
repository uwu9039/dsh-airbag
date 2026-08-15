/**
 * First-run workspace health scan (G6). Read-only: enumerates sensitive
 * files and embedded credential literals without persisting file contents.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { Dirent } from 'node:fs'
import type { RuleSet } from './rules.ts'

export interface ScanFinding {
  /** Absolute path of the finding. */
  path: string
  kind: 'env-file' | 'credential-file' | 'embedded-credential' | 'git-remote-credential'
  /** Rule label when an embedded credential was detected. */
  category?: string
  /** Masked fragment of the embedded credential. */
  masked?: string
}

export interface ScanOptions {
  maxFileBytes: number
  maxFiles: number
}

/** Directory names never entered during a scan. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '.venv', 'venv', '__pycache__', '.next', '.nuxt', '.cache'])

/** File names treated as credential-bearing regardless of content. */
const CREDENTIAL_FILE_NAMES = /^(?:\.env|\.env\.[A-Za-z0-9_.-]+|\.netrc|id_rsa|id_dsa|id_ecdsa|id_ed25519|\.pgpass|credentials\.json|credentials\.yaml|secrets\.(?:json|ya?ml|txt|env)|\.aws\/credentials)$/

/** Extensions treated as private-key material. */
const KEY_EXTENSIONS = /\.(?:pem|p12|pfx|key|p8|ppk)$/i

/** Text-ish extensions eligible for content scanning. */
const TEXT_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|cs|php|sh|bash|zsh|fish|ps1|bat|cmd|json|jsonc|ya?ml|toml|ini|conf|cfg|env|txt|md|html|css|scss|sql|xml|properties|gradle|lock|log)$/i

async function isReadableFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isFile()
  } catch {
    return false
  }
}

/** Walk a directory tree (bounded) and yield files. */
async function* walkFiles(dir: string, opts: ScanOptions): AsyncGenerator<string> {
  let seen = 0
  async function* inner(current: string, depth: number): AsyncGenerator<string> {
    if (depth > 6 || seen >= opts.maxFiles) return
    let entries: Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (seen >= opts.maxFiles) return
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        yield* inner(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      seen += 1
      yield full
    }
  }
  yield* inner(dir, 0)
}

/** Detect a git remote URL carrying embedded credentials (user:pass@). */
function gitRemoteCredential(configPath: string, text: string): ScanFinding | null {
  const match = /url\s*=\s*(?:https?|ssh):\/\/[^/\s@]+:[^@\s]+@/.exec(text)
  if (match === null) return null
  const raw = match[0]
  return {
    path: configPath,
    kind: 'git-remote-credential',
    masked: raw.length > 24 ? `${raw.slice(0, 12)}***${raw.slice(-12)}` : '***',
  }
}

/**
 * Scan one workspace directory for sensitive files and embedded credentials.
 * Never stores file contents; findings carry paths + masked fragments only.
 */
export async function scanWorkspace(
  workspaceDir: string,
  rules: RuleSet,
  opts: ScanOptions,
): Promise<ScanFinding[]> {
  const root = resolve(workspaceDir)
  const findings: ScanFinding[] = []
  const seenPaths = new Set<string>()

  const push = (finding: ScanFinding): void => {
    if (seenPaths.has(finding.path)) return
    seenPaths.add(finding.path)
    findings.push(finding)
  }

  // Git remote credentials: check the repo config directly (.git is skipped
  // by the walker).
  const gitConfig = join(root, '.git', 'config')
  const gitText = await readFile(gitConfig, 'utf8').catch(() => '')
  if (gitText.length > 0) {
    const remote = gitRemoteCredential(gitConfig, gitText)
    if (remote !== null) push(remote)
  }

  for await (const file of walkFiles(root, opts)) {
    const name = basename(file)
    const rel = file.replace(root, '').replace(/\\/g, '/')

    // Credential-bearing file names.
    if (CREDENTIAL_FILE_NAMES.test(name) || (KEY_EXTENSIONS.test(name) && rel.split('/').length <= 3)) {
      push({ path: file, kind: name.startsWith('.env') ? 'env-file' : 'credential-file' })
    }
    // Content scan for embedded credentials (text-ish, bounded size).
    if (!TEXT_EXTENSIONS.test(name) && !name.startsWith('.env')) continue
    const info = await stat(file).catch(() => null)
    if (info === null || info.size > opts.maxFileBytes) continue
    const content = await readFile(file, 'utf8').catch(() => '')
    // Skip rule hits that are pure placeholders (low noise).
    const matches = rules.scan(content).filter((m) => !m.ruleId.includes('placeholder'))
    for (const match of matches.slice(0, 3)) {
      push({
        path: file,
        kind: 'embedded-credential',
        category: match.label,
        masked: match.masked,
      })
    }
  }

  return findings
}

/** Summarize findings for the scan event note. */
export function summarizeFindings(findings: ScanFinding[]): string {
  const byKind = new Map<string, number>()
  for (const f of findings) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1)
  const parts = [...byKind.entries()].map(([kind, count]) => `${kind}=${count}`)
  return parts.join(' ') || 'clean'
}
