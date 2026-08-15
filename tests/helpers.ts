/**
 * Fake secrets for tests, assembled at runtime.
 *
 * Each value is built by concatenation so no source file contains a
 * contiguous key-shaped token (e.g. `sk-` + 32 hex). GitHub push protection
 * would otherwise block every push of the fixture files as "secrets".
 * The assembled strings are exactly the shapes the rule engine must detect,
 * so test semantics are unchanged.
 */

export const fakeDeepSeekKey = (): string => 'sk-' + '0123456789abcdef0123456789abcdef'

export const fakeAnthropicKey = (): string => 'sk-ant-' + 'abcdefghijklmnopqrstuvwxyz123456'

export const fakeOpenAiKey = (): string => 'sk-proj-' + 'AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'

export const fakeAwsKey = (): string => 'AKIA' + 'IOSFODNN7EXAMPLE'

export const fakeAliyunKey = (): string => 'LTAI5t' + 'ABCDEFGHIJKLMN'

export const fakeTencentKey = (): string => 'AKID' + 'abcdefghijklmno12345'

export const fakeGitHubPat = (): string => 'ghp_' + 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ'

export const fakeGitLabPat = (): string => 'glpat-' + 'abcdefghijklmnopqrstuvwxyz1234'

export const fakeTelegramToken = (): string => '123456789:' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk'

export const fakeHex32 = (): string => '0123456789abcdef0123456789abcdef'
