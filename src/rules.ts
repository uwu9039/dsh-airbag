/**
 * Secret detection rule engine. Pure, zero-dependency, deterministic.
 *
 * Built-in rules cover the credential families users most often leak into an
 * agent context; custom rules (from `~/.dsh/airbag/rules.yaml`) merge on top.
 * The engine never stores the matched plaintext — callers only receive a
 * masked fragment and a SHA-256 prefix.
 */

/** How a matched secret is handled by default (per rule). */
export type RuleAction = 'block' | 'redact' | 'warn'

/** Relative weight of a matched secret, used for notice levels. */
export type RuleSeverity = 'low' | 'med' | 'high'

/** One compiled secret rule. */
export interface SecretRule {
  /** Stable id (builtin ids are kebab-case; custom ids are `custom-<n>`). */
  id: string
  /** Human-readable label, e.g. "DeepSeek API Key". */
  label: string
  /** Compiled matcher. */
  pattern: RegExp
  /** Default paste-direction action. */
  action: RuleAction
  severity: RuleSeverity
  /** Default notice level (0 = none … 4 = strongest). */
  notice: number
  /** Marker for example/placeholder look-alikes (low confidence by design). */
  placeholder?: boolean
}

/** One detection result. */
export interface SecretMatch {
  ruleId: string
  label: string
  action: RuleAction
  severity: RuleSeverity
  notice: number
  /** Masked fragment: first 4 + `***` + last 4 chars of the matched text. */
  masked: string
  /** SHA-256 prefix (12 hex chars) of the matched text — never the plaintext. */
  hashPrefix: string
}

/** A user-authored custom rule (from the YAML file). */
export interface CustomRuleEntry {
  pattern: string
  label?: string
  action?: RuleAction
  severity?: RuleSeverity
  notice?: number
}

/** One paste/write whitelist entry: plain substring match (case-sensitive). */
export type WhitelistEntry = string

/* ------------------------------------------------------------------ *
 * Built-in rule table
 * ------------------------------------------------------------------ */

/** Example/placeholder look-alikes are flagged but never blocked by default. */
const PLACEHOLDER_PATTERN = /\b(?:sk-[0-9]{4,}|your[-_](?:api[-_]?)?key|example[-_](?:api[-_]?)?key|xxxxx+|your-token|api[-_]?key[-_]?here|<[^>]*(?:key|token|secret)[^>]*>)\b/i

function rule(
  id: string,
  label: string,
  pattern: RegExp,
  action: RuleAction,
  severity: RuleSeverity,
  notice: number,
  placeholder = false,
): SecretRule {
  return { id, label, pattern, action, severity, notice, placeholder }
}

export const BUILTIN_RULES: readonly SecretRule[] = [
  // DeepSeek — sk- + 32+ hex chars.
  rule('deepseek-api-key', 'DeepSeek API Key', /\bsk-[0-9a-f]{32,}\b/i, 'block', 'high', 3),
  // OpenAI — sk-proj- / sk-svcacct- / sk- (long base64-ish tail).
  rule('openai-api-key', 'OpenAI API Key', /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}\b/, 'block', 'high', 3),
  rule('openai-legacy-key', 'OpenAI Legacy API Key', /\bsk-[A-Za-z0-9]{20,}(?:T3BlbkFJ)[A-Za-z0-9]{10,}\b/, 'block', 'high', 3),
  // Anthropic.
  rule('anthropic-api-key', 'Anthropic API Key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/, 'block', 'high', 3),
  // Google AI Studio / Gemini / GCP.
  rule('google-ai-api-key', 'Google AI / GCP API Key', /\bAIza[0-9A-Za-z_-]{35,}\b/, 'block', 'high', 3),
  // AWS.
  rule('aws-access-key-id', 'AWS Access Key ID', /\bAKIA[0-9A-Z]{16,}\b/, 'block', 'high', 3),
  rule('aws-secret-key', 'AWS Secret Access Key', /\baws[-_]?secret[-_]?access[-_]?key\s*[:=]\s*["']?[A-Za-z0-9/+=]{40,}\b/i, 'block', 'high', 3),
  rule('aws-session-token', 'AWS Session Token', /\b(?:aws)?[-_]?session[-_]?token\s*[:=]\s*["']?[A-Za-z0-9/+=]{100,}\b/i, 'block', 'high', 3),
  // GitHub.
  rule('github-pat', 'GitHub Personal Access Token', /\bghp_[0-9A-Za-z]{36,}\b/, 'block', 'high', 3),
  rule('github-fine-grained-pat', 'GitHub Fine-grained PAT', /\bgithub_pat_[0-9A-Za-z_]{22,}\b/, 'block', 'high', 3),
  rule('github-oauth', 'GitHub OAuth Token', /\bgho_[0-9A-Za-z]{36,}\b/, 'block', 'high', 3),
  rule('github-user-token', 'GitHub User Token', /\bghu_[0-9A-Za-z]{36,}\b/, 'block', 'high', 3),
  rule('github-refresh', 'GitHub Refresh Token', /\bghr_[0-9A-Za-z]{36,}\b/, 'block', 'high', 3),
  rule('github-app-token', 'GitHub App Token', /\b(?:ghs|ghb)_[0-9A-Za-z]{36,}\b/, 'block', 'high', 3),
  // GitLab.
  rule('gitlab-pat', 'GitLab Personal Access Token', /\bglpat-[0-9A-Za-z_-]{20,}\b/, 'block', 'high', 3),
  rule('gitlab-ci-job-token', 'GitLab CI Job Token', /\bglci-[0-9A-Za-z_-]{20,}\b/, 'block', 'high', 3),
  // Slack.
  rule('slack-token', 'Slack Token', /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/, 'block', 'high', 3),
  // Telegram.
  rule('telegram-bot-token', 'Telegram Bot Token', /\b\d{8,10}:[A-Za-z0-9_-]{35,}\b/, 'block', 'high', 3),
  // Discord.
  rule('discord-bot-token', 'Discord Bot Token', /\b[MN][A-Za-z\d]{23,}\.[\w-]{6,}\.[\w-]{27,}\b/, 'block', 'high', 3),
  // Stripe.
  rule('stripe-live-key', 'Stripe Live API Key', /\b(?:sk|rk)_live_[0-9A-Za-z]{24,}\b/, 'block', 'high', 3),
  rule('stripe-test-key', 'Stripe Test API Key', /\b(?:sk|rk)_test_[0-9A-Za-z]{24,}\b/, 'redact', 'med', 2),
  // Hugging Face.
  rule('huggingface-token', 'Hugging Face Token', /\bhf_[A-Za-z0-9]{34,}\b/, 'block', 'high', 3),
  // npm / PyPI.
  rule('npm-token', 'npm Access Token', /\bnpm_[0-9A-Za-z]{36,}\b/, 'block', 'high', 3),
  rule('pypi-token', 'PyPI Upload Token', /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}\b/, 'block', 'high', 3),
  // Datadog / SendGrid / Twilio / Shopify.
  rule('datadog-key', 'Datadog API/App Key', /\b(?:api|app)_key_[0-9A-Za-z]{32,}\b/, 'block', 'high', 3),
  rule('sendgrid-key', 'SendGrid API Key', /\bSG\.[0-9A-Za-z_-]{22,}\.[0-9A-Za-z_-]{43,}\b/, 'block', 'high', 3),
  rule('twilio-api-key', 'Twilio API Key', /\bSK[0-9a-fA-F]{32,}\b/, 'block', 'high', 3),
  rule('shopify-token', 'Shopify Access Token', /\bshpat_[0-9a-fA-F]{32,}\b/, 'block', 'high', 3),
  rule('shopify-private-app-token', 'Shopify Private App Token', /\bshppa_[0-9a-fA-F]{32,}\b/, 'block', 'high', 3),
  // Atlassian / Jira / Confluence.
  rule('atlassian-api-token', 'Atlassian API Token', /\bATATT3[A-Za-z0-9_-]{50,}\b/, 'block', 'high', 3),
  // Vercel / Netlify / Cloudflare.
  rule('vercel-token', 'Vercel Token', /\b[A-Za-z0-9]{24,}_[A-Za-z0-9]{24,}\b(?!\s*:)/, 'warn', 'med', 2),
  rule('netlify-token', 'Netlify Token', /\bnfp_[0-9A-Za-z]{40,}\b/, 'block', 'high', 3),
  rule('cloudflare-api-token', 'Cloudflare API Token', /\b[A-Za-z0-9_-]{40,}\b.{0,40}?(?:CF-|cloudflare)/i, 'warn', 'med', 2),
  // 国内云厂商 AccessKey。
  rule('aliyun-access-key-id', '阿里云 AccessKey ID', /\bLTAI[0-9A-Za-z]{12,}\b/, 'block', 'high', 3),
  rule('aliyun-access-key-secret', '阿里云 AccessKey Secret', /\b(?:AccessKeySecret|access[-_]?key[-_]?secret)\s*[:=]\s*["']?[A-Za-z0-9]{30,}\b/i, 'block', 'high', 3),
  rule('tencentcloud-secret-id', '腾讯云 SecretId', /\bAKID[0-9A-Za-z]{13,}\b/, 'block', 'high', 3),
  rule('tencentcloud-secret-key', '腾讯云 SecretKey', /\b(?:SecretKey|secret[-_]?key)\s*[:=]\s*["']?[A-Za-z0-9]{32,}\b/i, 'block', 'high', 3),
  rule('huaweicloud-ak-sk', '华为云 AK/SK', /\b(?:AK|SK)\s*[:=]\s*["']?[A-Za-z0-9+/=]{32,}\b/i, 'block', 'high', 3),
  rule('volcengine-ak-sk', '火山引擎 AK/SK', /\b(?:AK|SK)\s*[:=]\s*["']?[A-Za-z0-9+/=]{32,}\b/i, 'block', 'high', 3),
  // 通用云服务密钥赋值。
  rule('baidu-cloud-ak', '百度智能云 AccessKey', /\b[0-9a-f]{32,}\b.{0,40}?(?:百度|baidu)/i, 'warn', 'med', 2),
  // JWT.
  rule('jwt', 'JWT Token', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, 'block', 'high', 3),
  // PEM / OpenSSH private keys.
  rule('pem-private-key', 'PEM 私钥块', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED |PGP )?PRIVATE KEY-----/, 'block', 'high', 3),
  rule('ssh-private-key-file', 'OpenSSH 私钥文件内容', /\bBEGIN OPENSSH PRIVATE KEY\b/, 'block', 'high', 3),
  // 通用键值赋值（低置信，仅警告）。
  rule('generic-key-assignment', '疑似密钥赋值', /\b(?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|client[_-]?secret|auth[_-]?token|bearer)\b\s*[:=]\s*["']?[A-Za-z0-9_\-.]{16,}\b/i, 'warn', 'med', 2),
  // 占位/示例 key。
  rule('placeholder-secret', '示例/占位密钥', PLACEHOLDER_PATTERN, 'warn', 'low', 1, true),
]

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

/** Mask a secret: first 4 + `***` + last 4 chars. */
export function maskSecret(value: string): string {
  if (value.length <= 12) return `${value.slice(0, 2)}***`
  return `${value.slice(0, 4)}***${value.slice(-4)}`
}

/** SHA-256 hex prefix (12 chars) of a value — safe to persist. */
export async function hashPrefix(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).slice(0, 6)
    .map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * A compiled rule set: built-ins plus optional custom rules and whitelist.
 * Whitelist is plain substring matching — a whitelisted fragment neutralizes
 * every rule for the scanned text it appears in.
 */
export class RuleSet {
  readonly rules: readonly SecretRule[]

  constructor(
    builtin: readonly SecretRule[] = BUILTIN_RULES,
    custom: readonly CustomRuleEntry[] = [],
    readonly whitelist: readonly WhitelistEntry[] = [],
  ) {
    const compiled: SecretRule[] = []
    custom.forEach((entry, index) => {
      if (entry.pattern.length === 0) return
      const pattern = new RegExp(entry.pattern) // throws on invalid regex: loud config failure
      compiled.push({
        id: `custom-${index + 1}`,
        label: entry.label ?? '自定义规则',
        pattern,
        action: entry.action ?? 'block',
        severity: entry.severity ?? 'med',
        notice: entry.notice ?? 3,
      })
    })
    this.rules = [...builtin, ...compiled]
  }

  isWhitelisted(text: string): boolean {
    return this.whitelist.some((entry) => entry.length > 0 && text.includes(entry))
  }

  /**
   * Scan text and return one match per rule, in rule order, with the
   * FIRST occurrence of each. Whitelisted text yields no matches.
   * Pure synchronous; hash prefixes are attached by {@link scanHashed}.
   */
  scan(text: string): SecretMatch[] {
    if (text.length === 0 || this.isWhitelisted(text)) return []
    const matches: SecretMatch[] = []
    for (const rule of this.rules) {
      const hit = rule.pattern.exec(text)
      if (hit === null) continue
      matches.push({
        ruleId: rule.id,
        label: rule.label,
        action: rule.action,
        severity: rule.severity,
        notice: rule.notice,
        masked: maskSecret(hit[0]),
        hashPrefix: '',
      })
    }
    return matches
  }

  /** Scan and attach hash prefixes (async; use for persistence paths). */
  async scanHashed(text: string): Promise<SecretMatch[]> {
    const matches = this.scan(text)
    for (const match of matches) {
      const raw = this.rawOf(text, match.ruleId)
      if (raw !== null) match.hashPrefix = await hashPrefix(raw)
    }
    return matches
  }

  /** Re-extract the raw matched text for one rule id (internal helper). */
  private rawOf(text: string, ruleId: string): string | null {
    const rule = this.rules.find((r) => r.id === ruleId)
    if (rule === undefined) return null
    const hit = rule.pattern.exec(text)
    return hit?.[0] ?? null
  }
}

