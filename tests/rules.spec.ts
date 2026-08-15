import { describe, expect, it } from 'vitest'
import { BUILTIN_RULES, RuleSet, maskSecret, hashPrefix } from '../src/rules.ts'
import {
  fakeDeepSeekKey,
  fakeAnthropicKey,
  fakeOpenAiKey,
  fakeAwsKey,
  fakeAliyunKey,
  fakeTencentKey,
  fakeGitHubPat,
  fakeGitLabPat,
  fakeTelegramToken,
} from './helpers.ts'

describe('built-in rules', () => {
  it('detects DeepSeek / OpenAI / Anthropic keys', () => {
    const set = new RuleSet()
    expect(set.scan('use ' + fakeDeepSeekKey() + ' here')[0]?.label).toBe('DeepSeek API Key')
    expect(set.scan('key=' + fakeAnthropicKey())[0]?.label).toBe('Anthropic API Key')
    expect(set.scan('token ' + fakeOpenAiKey())[0]?.label).toBe('OpenAI API Key')
  })

  it('detects cloud and platform credentials', () => {
    const set = new RuleSet()
    expect(set.scan(fakeAwsKey())[0]?.label).toBe('AWS Access Key ID')
    expect(set.scan(fakeAliyunKey())[0]?.label).toBe('阿里云 AccessKey ID')
    expect(set.scan(fakeTencentKey())[0]?.label).toBe('腾讯云 SecretId')
    expect(set.scan(fakeGitHubPat())[0]?.label).toBe('GitHub Personal Access Token')
    expect(set.scan(fakeGitLabPat())[0]?.label).toBe('GitLab Personal Access Token')
    expect(set.scan(fakeTelegramToken())[0]?.label).toBe('Telegram Bot Token')
    expect(set.scan('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U')[0]?.label).toBe('JWT Token')
    expect(set.scan('-----BEGIN RSA PRIVATE KEY-----')[0]?.label).toBe('PEM 私钥块')
  })

  it('masks matched secrets', () => {
    const set = new RuleSet()
    const match = set.scan(fakeDeepSeekKey())[0]!
    expect(match.masked).toMatch(/^\S{4}\*{3}\S{4}$/)
    expect(match.masked).not.toContain('0123456789abcdef')
  })

  it('never matches empty text', () => {
    expect(new RuleSet().scan('')).toEqual([])
  })
})

describe('placeholder look-alikes', () => {
  it('flags placeholders as warn regardless of rule action', () => {
    const set = new RuleSet()
    const match = set.scan('api key is your-api-key-here')
    expect(match[0]?.ruleId).toBe('placeholder-secret')
    expect(match[0]?.action).toBe('warn')
  })
})

describe('whitelist', () => {
  it('suppresses all matches for whitelisted text', () => {
    const set = new RuleSet(BUILTIN_RULES, [], ['sk-0123'])
    expect(set.scan(fakeDeepSeekKey())).toEqual([])
  })
})

describe('custom rules', () => {
  it('compiles YAML-style custom entries and fails loud on invalid regex', () => {
    const set = new RuleSet(BUILTIN_RULES, [
      { pattern: 'INT_[A-Z0-9]{12}', label: '内网 Token', action: 'block' },
    ])
    expect(set.scan('token INT_ABCDEF123456 x')[0]?.label).toBe('内网 Token')
    expect(() => new RuleSet(BUILTIN_RULES, [{ pattern: '([' }])).toThrow()
  })
})

describe('hashPrefix', () => {
  it('produces a 12-hex prefix and never the plaintext', async () => {
    const prefix = await hashPrefix(fakeDeepSeekKey())
    expect(prefix).toMatch(/^[0-9a-f]{12}$/)
    expect(prefix).not.toContain('sk-')
  })
})

describe('maskSecret', () => {
  it('keeps short values opaque', () => {
    expect(maskSecret('abc')).toBe('ab***')
  })
  it('keeps long values recognizable', () => {
    expect(maskSecret(fakeDeepSeekKey())).toBe('sk-0***cdef')
  })
})
