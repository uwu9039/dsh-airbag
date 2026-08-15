import { describe, expect, it } from 'vitest'
import { RuleSet } from '../src/rules.ts'
import { WRITE_TOOLS, decideWrite, extractWriteText } from '../src/write-guard.ts'
import { fakeDeepSeekKey, fakeHex32 } from './helpers.ts'

const SK = fakeDeepSeekKey()

describe('WRITE_TOOLS', () => {
  it('covers the v0.2 write-direction scope', () => {
    expect(WRITE_TOOLS.has('write')).toBe(true)
    expect(WRITE_TOOLS.has('edit')).toBe(true)
    expect(WRITE_TOOLS.has('bash')).toBe(true)
    expect(WRITE_TOOLS.has('read')).toBe(false)
    expect(WRITE_TOOLS.has('grep')).toBe(false)
  })
})

describe('extractWriteText', () => {
  it('extracts command keys', () => {
    const text = extractWriteText({ command: 'echo x > log.txt', cwd: '/tmp' })
    expect(text).toContain('echo x > log.txt')
  })

  it('extracts content keys and structured edits', () => {
    const text = extractWriteText({
      path: '/tmp/app.js',
      content: `const key = "${SK}"`,
    })
    expect(text).toContain(SK)
    const editText = extractWriteText({
      path: '/tmp/app.js',
      edits: [{ old: 'placeholder', new: SK }],
    })
    expect(editText).toContain(SK)
  })

  it('returns empty for non-object or empty args', () => {
    expect(extractWriteText(undefined)).toBe('')
    expect(extractWriteText({ path: '/tmp/a.txt' })).toContain('/tmp/a.txt') // JSON fallback
  })
})

describe('decideWrite', () => {
  it('blocks high-confidence secrets', () => {
    const decision = decideWrite(`echo ${SK} > log.txt`, new RuleSet())
    expect(decision.kind).toBe('block')
    expect(decision.match?.label).toBe('DeepSeek API Key')
  })

  it('asks for warn-tier rules', () => {
    const decision = decideWrite('api_key = "' + fakeHex32() + '"', new RuleSet())
    // generic-key-assignment is warn tier → ask.
    expect(decision.kind).toBe('ask')
  })

  it('allows clean content and placeholder look-alikes', () => {
    expect(decideWrite('export const x = 1', new RuleSet()).kind).toBe('allow')
    expect(decideWrite('key is your-api-key-here', new RuleSet()).kind).toBe('allow')
  })

  it('honors whitelist', () => {
    const set = new RuleSet([], [], [SK.slice(0, 8)])
    expect(decideWrite(`echo ${SK} > log.txt`, set).kind).toBe('allow')
  })
})
