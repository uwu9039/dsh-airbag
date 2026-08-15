import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RuleSet } from '../src/rules.ts'
import { scanWorkspace, summarizeFindings } from '../src/scan.ts'
import { fakeDeepSeekKey, fakeAnthropicKey, fakeGitHubPat } from './helpers.ts'

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'airbag-scan-'))
  await writeFile(join(dir, '.env'), 'DEEPSEEK_API_KEY=' + fakeDeepSeekKey() + '\n')
  await mkdir(join(dir, 'src'), { recursive: true })
  await writeFile(join(dir, 'src', 'config.ts'), 'export const key = "' + fakeAnthropicKey() + '"\n')
  await mkdir(join(dir, 'node_modules'), { recursive: true })
  await writeFile(join(dir, 'node_modules', 'fake.env'), 'x=1\n')
  await writeFile(join(dir, 'README.md'), '# demo\n')
  return dir
}

const opts = { maxFileBytes: 256 * 1024, maxFiles: 200 }

describe('scanWorkspace', () => {
  it('finds env files and embedded credentials, skips node_modules', async () => {
    const dir = await makeWorkspace()
    const findings = await scanWorkspace(dir, new RuleSet(), opts)
    const kinds = findings.map((f) => f.kind)
    expect(kinds).toContain('env-file')
    expect(kinds).toContain('embedded-credential')
    expect(findings.some((f) => f.path.includes('node_modules'))).toBe(false)
    // No plaintext in findings
    expect(JSON.stringify(findings)).not.toContain(fakeDeepSeekKey())
  })

  it('detects git remote credentials in .git/config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'airbag-git-'))
    await mkdir(join(dir, '.git'), { recursive: true })
    await writeFile(join(dir, '.git', 'config'), '[remote "origin"]\n\turl = https://user:' + fakeGitHubPat() + '@github.com/me/repo.git\n')
    const findings = await scanWorkspace(dir, new RuleSet(), opts)
    expect(findings.some((f) => f.kind === 'git-remote-credential')).toBe(true)
  })

  it('summarizes findings per kind', async () => {
    const dir = await makeWorkspace()
    const findings = await scanWorkspace(dir, new RuleSet(), opts)
    const summary = summarizeFindings(findings)
    expect(summary).toContain('env-file=')
    expect(summary).toContain('embedded-credential=')
  })
})
