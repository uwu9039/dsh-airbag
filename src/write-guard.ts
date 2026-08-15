/**
 * A2 write guard: intercepts model write-direction tool calls (write / edit /
 * bash / run_code) whose arguments carry a secret pattern, and denies the
 * call or escalates it to the native approval seam.
 *
 * Hook contract follows the official tool-execution pipeline: a
 * `tools/pre-execute` waterfall listener returns `{ kind: 'deny' }` to stop
 * the call or `{ kind: 'ask' }` to route through `ctx.approval` (the Web UI
 * renders the native confirmation). Decisions never bypass the harness.
 */
import type { RuleSet, SecretMatch } from './rules.ts'

/** The minimal ToolExecution shape this guard reads (structural, no dsh-tools dep). */
export interface WriteGuardExec {
  name: string
  arguments?: Record<string, unknown>
}

/** The decision vocabulary of the pre-execute waterfall. */
export type PreDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason: string }

/** Tool names treated as write-direction (v0.2 scope). */
export const WRITE_TOOLS = new Set(['write', 'edit', 'bash', 'run_code'])

/** Argument keys whose string values carry command text. */
const COMMAND_KEYS = ['command', 'script', 'query', 'sql'] as const

/** Argument keys whose string values carry file content to be written. */
const CONTENT_KEYS = ['content', 'text', 'data'] as const

/** Extract scanable text from one tool call's arguments. */
export function extractWriteText(args: Record<string, unknown> | undefined): string {
  if (args === undefined || args === null) return ''
  const parts: string[] = []
  for (const key of COMMAND_KEYS) {
    const value = args[key]
    if (typeof value === 'string') parts.push(value)
  }
  for (const key of CONTENT_KEYS) {
    const value = args[key]
    if (typeof value === 'string') parts.push(value)
  }
  // Structured edits (edit tool): scan the before/after strings too.
  const edits = args.edits
  if (Array.isArray(edits)) {
    for (const edit of edits) {
      if (typeof edit !== 'object' || edit === null) continue
      const record = edit as Record<string, unknown>
      for (const key of ['old', 'new', 'oldText', 'newText', 'original', 'replacement']) {
        const value = record[key]
        if (typeof value === 'string') parts.push(value)
      }
    }
  }
  // Fallback: the whole JSON so structured payloads are never missed.
  parts.push(JSON.stringify(args))
  return parts.join('\n')
}

/** One write-direction interception decision. */
export interface WriteDecision {
  kind: 'block' | 'ask' | 'allow'
  match?: SecretMatch
}

/**
 * Decide what to do with one scanned write payload. Pure and synchronous so
 * it is unit-testable; the caller turns `block` into `deny` and `ask` into
 * the native approval routing.
 */
export function decideWrite(text: string, ruleSet: RuleSet): WriteDecision {
  if (text.length === 0) return { kind: 'allow' }
  const matches = ruleSet.scan(text)
  if (matches.length === 0) return { kind: 'allow' }
  // Placeholder look-alikes never block writes.
  const match = matches.find((m) => !m.ruleId.includes('placeholder'))
  if (match === undefined) return { kind: 'allow' }
  return {
    kind: match.action === 'block' ? 'block' : 'ask',
    match,
  }
}
