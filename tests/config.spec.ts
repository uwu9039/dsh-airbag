import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings, parseCustomRules } from '../src/config.ts'

describe('normalizeSettings', () => {
  it('returns defaults for garbage input', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('x')).toEqual(DEFAULT_SETTINGS)
  })

  it('clamps notice levels to 0..4 and rejects bad action values', () => {
    const normalized = normalizeSettings({
      defaultAction: 'explode',
      noticeLevels: { paste: 9, write: -1, leak: 3 },
      dnd: true,
      whitelist: ['sk-1234', 42],
    })
    expect(normalized.defaultAction).toBe('block')
    expect(normalized.noticeLevels.paste).toBe(2)
    expect(normalized.noticeLevels.write).toBe(3)
    expect(normalized.noticeLevels.leak).toBe(3)
    expect(normalized.dnd).toBe(true)
    expect(normalized.whitelist).toEqual(['sk-1234'])
  })

  it('accepts a full valid settings object', () => {
    const normalized = normalizeSettings({
      defaultAction: 'redact',
      noticeLevels: { paste: 2, write: 4, leak: 3, scan: 1 },
      dnd: false,
      sound: true,
      whitelist: ['example'],
    })
    expect(normalized.defaultAction).toBe('redact')
    expect(normalized.noticeLevels.write).toBe(4)
    expect(normalized.sound).toBe(true)
  })
})

describe('parseCustomRules', () => {
  it('parses a YAML list', () => {
    const rules = parseCustomRules(`
- pattern: 'INT_[A-Z0-9]{12}'
  label: 内网 Token
  action: block
- pattern: 'prod\\.internal'
  action: warn
`)
    expect(rules).toHaveLength(2)
    expect(rules[0]).toMatchObject({ label: '内网 Token', action: 'block', severity: 'med' })
    expect(rules[1]?.action).toBe('warn')
  })

  it('rejects non-list or pattern-less entries loudly', () => {
    expect(() => parseCustomRules('just: a map')).toThrow()
    expect(() => parseCustomRules('- label: no pattern')).toThrow()
  })

  it('treats empty content as no rules', () => {
    expect(parseCustomRules('')).toEqual([])
    expect(parseCustomRules('# comment only')).toEqual([])
  })
})
