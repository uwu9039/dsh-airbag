# dsh-airbag

Non-intrusive safety belt for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): blocks API keys pasted to the agent, tracks leak events, blocks secret writes, and offers a first-run workspace health scan.

DeepSeek Harness 的非侵入式安全护栏：拦截粘贴给 Agent 的 API 密钥、追踪泄露事件、拦截密钥写入，并提供首次工作区安全体检。

## Features

- **Paste guard (A1)** — pasting a secret (DeepSeek / OpenAI / Anthropic keys, AWS, GitHub PATs, JWT, PEM private-key blocks, Aliyun / Tencent Cloud AccessKeys, and 45+ built-in patterns) into the composer is **blocked**, **redacted**, or **warned** per your settings. The decision happens synchronously inside the paste event; nothing is ever sent to the model.
- **Write guard (A2)** — model write-direction tool calls (`write` / `edit` / `bash` / `run_code`) whose arguments carry a secret are **denied** (hard block) or routed through the **native approval seam** (`ask`) — the confirmation stays in the harness UI, never a bypass.
- **Approval-fatigue insights (B)** — a passive observer on the native approval waterfall: it never decides, but it measures asked→decided timing and flags **blind approvals** (granted in under 2s — rubber-stamping) and **fatigue episodes** (30 minutes of dense, near-universal grants). Insights land in the event feed as ordinary records.
- **Corner notification center (G1)** — four non-intrusive levels: L0 silent, L1 badge only, L2 corner toast (auto-dismisses, no sound, no focus steal), L3 persistent badge. Events collapse under the same 5-minute window; a global do-not-disturb switch hides everything.
- **First-run health scan (G6)** — read-only scan of a workspace for `.env` files, credential files, embedded secrets, and git remote credentials. Reports masked fragments only.
- **Privacy by construction** — plaintext secrets never touch disk, logs, or telemetry: only masked fragments (`sk-0***cdef`) and SHA-256 prefixes are persisted, under `~/.dsh/airbag/`.

## Install

Pick any of the three methods below, then **restart DSH Web**. A 🛡️ **Airbag** button appears in the bottom-right corner (with a badge on first run — that's the health-scan invitation).

### Method 1: From npm (recommended)

```sh
dsh plugin --profile web add dsh-airbag
```

### Method 2: From a tarball

Download `dsh-airbag-0.4.2.tgz` from the [GitHub Release](https://github.com/uwu9039/dsh-airbag/releases/latest) page (or generate it yourself with `npm pack dsh-airbag`), then:

```sh
dsh plugin --profile web add ./dsh-airbag-0.4.2.tgz
```

You can also point `add` directly at the release asset (identical content to the npm package):

```sh
dsh plugin --profile web add https://github.com/uwu9039/dsh-airbag/releases/download/v0.4.2/dsh-airbag-0.4.2.tgz
```

### Method 3: From GitHub

```sh
dsh plugin --profile web add github:uwu9039/dsh-airbag#<commit-sha>
```

> A GitHub install fetches **source, not built artifacts**: pnpm runs the `prepare` script (tsdown) to build on install. pnpm ≥10 refuses to run a git dependency's build script until it is explicitly allowed, so the first `add` fails — add the package to the profile's `pnpm-workspace.yaml` first, then re-run the command above:

```yaml
# at ~/.dsh/profiles/<profile>/pnpm-workspace.yaml
allowBuilds:
  dsh-airbag: true
```

To uninstall: `dsh plugin --profile web remove dsh-airbag`.

## Usage

Click the 🛡️ button to open the panel with three tabs:

| Tab | What it does |
|---|---|
| 拦截记录 (Events) | Today's interceptions: time, category, action, masked fragment; clear history |
| 体检 (Scan) | Enter a workspace path and run the read-only health scan |
| 设置 (Settings) | Default action (block/redact/warn), per-event notice levels (L0–L4), do-not-disturb, sound, whitelist, custom regex rules (`rules.yaml`) |

All notice levels and dispositions are configured **only** in the settings tab — notifications never offer in-place toggles.

Custom rules live in `~/.dsh/airbag/rules.yaml` (YAML list):

```yaml
- pattern: 'INT_[A-Z0-9]{12}'
  label: 内网 Token
  action: block
  severity: high
  notice: 3
```

## Configuration

The plugin accepts a `config` block in your `cordis.yml` row (all optional):

```yaml
- id: airbag
  name: dsh-airbag
  config:
    dataDir: ~/.dsh/airbag        # where events/config/rules live
    defaultAction: block          # block | redact | warn
    maxPasteBytes: 10240          # max pasted bytes scanned
    maxScanFileBytes: 262144      # per-file scan cap
    maxScanFiles: 200             # files content-scanned per health scan
```

## Development

Requirements: Node.js `^22.19 || >=24`, pnpm.

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm pack    # produces dsh-airbag-0.4.2.tgz
```

Smoke-test a local checkout:

```sh
pnpm run build
dsh plugin --profile web add ./dsh-airbag-0.4.2.tgz
dsh --profile web
```

## Architecture

```
src/index.ts             Host plugin entry: event store, settings file, scan, A2 write guard, HTTP API
src/rules.ts             Pure secret-detection engine (45+ built-in patterns, custom rules, whitelist)
src/store.ts             Append-only JSONL event store
src/config.ts            Deployment Config schema + user settings file (config.json / rules.yaml)
src/scan.ts              Read-only workspace health scan
src/write-guard.ts       A2 write-direction decision engine (pre-execute payload scanning)
src/approval-insight.ts  B approval-fatigue observer (blind-burst / fatigue detection, pure logic)
src/routes.ts            /dsh-airbag/api/* HTTP routes (web profiles only, via ctx.inject(['webServer']))
src/client/index.ts      Web client entry: mounts paste guard + notification center + panel
src/client/paste-guard.ts  A1 paste interception (composer-scoped, synchronous decision)
src/client/notify.ts     G1 corner notification center (4 levels, aggregation, DND)
src/client/panel.ts      Panel UI (events / scan / settings)
```

The host communicates with the browser half through the same-origin `/dsh-airbag/api/*` routes — no extra RPC surface. The A2 write guard listens on the official `tools/pre-execute` waterfall and returns `deny` / `ask` decisions; the browser half polls the event API every 30s so host-side interceptions surface as badge updates.

## Non-goals

- Reading-direction redaction is intentionally left to [dsh-guardian](https://github.com/lonelymoon87/dsh-guardian).
- The write time-machine (C — pre-write snapshots and one-click rollback) is planned for a later milestone.
- The plugin never replaces the native approval seam — every decision stays with you.

## License

[MIT](LICENSE)
