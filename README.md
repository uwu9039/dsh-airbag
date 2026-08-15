# dsh-airbag

DeepSeek Harness 的非侵入式安全护栏：拦截粘贴给 Agent 的 API 密钥、追踪泄露事件、拦截密钥写入，并提供首次工作区安全体检。

Non-intrusive safety belt for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): blocks API keys pasted to the agent, tracks leak events, blocks secret writes, and offers a first-run workspace health scan.

## 功能特性

- **粘贴拦截（A1）** —— 向输入框粘贴密钥（DeepSeek / OpenAI / Anthropic、AWS、GitHub PAT、JWT、PEM 私钥块、阿里云 / 腾讯云 AccessKey 等 45+ 内置模式）时，按你的设置**阻止 / 脱敏 / 警告**。判定在粘贴事件内同步完成，任何内容都不会发给模型。
- **写入拦截（A2）** —— 模型写方向工具调用（`write` / `edit` / `bash` / `run_code`）的参数携带密钥时，**硬拦截（deny）** 或转交**原生审批通道（ask）**——确认始终停留在 DSH 界面，绝无绕过。
- **审批疲劳洞察（B）** —— 原生审批链的被动观察者：不参与决策，只统计"发起→决定"耗时，标记**盲批**（<2s 授予）与**疲劳时段**（30 分钟密集批准），洞察以普通事件记录落入事件流。
- **边角通知中心（G1）** —— 四级通知：L0 静默、L1 仅角标、L2 边角 toast（自动消失、无声音、不抢焦点）、L3 常驻角标。5 分钟窗口内同类事件自动聚合，支持一键全局免打扰。
- **首次安全体检（G6）** —— 对工作区进行只读扫描：`.env` 文件、凭据文件、内嵌密钥、git 远端凭据，仅报告掩码片段。
- **隐私优先** —— 明文密钥永不落盘 / 进日志 / 进遥测：只持久化掩码片段（`sk-0***cdef`）与 SHA-256 前缀，存放于 `~/.dsh/airbag/`。

## 安装

任选以下一种方式安装，完成后**重启 DSH Web**。右下角会出现 🛡️ **Airbag** 按钮（首次运行带角标，即安全体检邀请）。

### 方式一：从 npm 安装（推荐）

```sh
dsh plugin --profile web add dsh-airbag
```

### 方式二：从 tarball 安装

从 [GitHub Release](https://github.com/uwu9039/dsh-airbag/releases/latest) 下载 `dsh-airbag-0.4.2.tgz`（或运行 `npm pack dsh-airbag` 自行生成），然后：

```sh
dsh plugin --profile web add ./dsh-airbag-0.4.2.tgz
```

也可以直接使用 Release 资产地址（与 npm 包内容一致）：

```sh
dsh plugin --profile web add https://github.com/uwu9039/dsh-airbag/releases/download/v0.4.2/dsh-airbag-0.4.2.tgz
```

### 方式三：从 GitHub 安装

```sh
dsh plugin --profile web add github:uwu9039/dsh-airbag#<commit-sha>
```

> GitHub 安装拉取的是**源码**，pnpm 会在安装时执行 `prepare` 脚本（tsdown）现场构建。pnpm ≥10 默认禁止执行 git 依赖的构建脚本，首次 `add` 会失败——先在 profile 的 `pnpm-workspace.yaml` 中授权该包，再重新执行上面的命令：

```yaml
# 位于 ~/.dsh/profiles/<profile>/pnpm-workspace.yaml
allowBuilds:
  dsh-airbag: true
```

卸载：`dsh plugin --profile web remove dsh-airbag`。

## 使用方法

点击右下角 🛡️ 按钮打开面板，共三个标签页：

| 标签页 | 功能 |
|---|---|
| 拦截记录 | 今日拦截事件：时间、类别、处置动作、掩码片段；可清空历史 |
| 体检 | 输入工作区路径，运行只读安全体检 |
| 设置 | 默认处置（阻止 / 脱敏 / 警告）、各事件通知级别（L0–L4）、免打扰、声音、白名单、自定义规则（rules.yaml） |

所有通知级别与处置方式**只在设置页配置**，通知浮层不提供就地开关。

自定义规则位于 `~/.dsh/airbag/rules.yaml`（YAML 列表）：

```yaml
- pattern: 'INT_[A-Z0-9]{12}'
  label: 内网 Token
  action: block
  severity: high
  notice: 3
```

## 配置

插件接受 `cordis.yml` 行中的 `config` 块（所有项均可选）：

```yaml
- id: airbag
  name: dsh-airbag
  config:
    dataDir: ~/.dsh/airbag        # 事件 / 配置 / 规则存放目录
    defaultAction: block          # block | redact | warn
    maxPasteBytes: 10240          # 粘贴扫描的最大字节数
    maxScanFileBytes: 262144      # 单文件体检上限
    maxScanFiles: 200             # 每次体检扫描的文件数
```

## 开发

要求：Node.js `^22.19 || >=24`，pnpm。

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm pack    # 产出 dsh-airbag-0.4.2.tgz
```

本地冒烟测试：

```sh
pnpm run build
dsh plugin --profile web add ./dsh-airbag-0.4.2.tgz
dsh --profile web
```

## 架构

```
src/index.ts             宿主插件入口：事件存储、设置、体检、A2 写入拦截、HTTP API
src/rules.ts             纯密钥检测引擎（45+ 内置模式、自定义规则、白名单）
src/store.ts             追加式 JSONL 事件存储
src/config.ts            Deployment Config schema + 用户设置文件（config.json / rules.yaml）
src/scan.ts              只读工作区安全体检
src/write-guard.ts       A2 写方向判定引擎（执行前 payload 扫描）
src/approval-insight.ts  B 审批疲劳观察（盲批 / 疲劳检测，纯逻辑）
src/routes.ts            /dsh-airbag/api/* HTTP 路由（web profile，经 ctx.inject(['webServer'])）
src/client/index.ts      Web 客户端入口：粘贴拦截 + 通知中心 + 面板
src/client/paste-guard.ts  A1 粘贴拦截（composer 作用域，同步判定）
src/client/notify.ts     G1 边角通知中心（四级、聚合、免打扰）
src/client/panel.ts      面板 UI（拦截记录 / 体检 / 设置）
```

宿主与浏览器端通过同源 `/dsh-airbag/api/*` 路由通信，无额外 RPC 面。A2 写入拦截监听官方 `tools/pre-execute` waterfall 并返回 `deny` / `ask`；浏览器端每 30s 轮询事件 API，使宿主侧拦截实时反映为角标更新。

## 非目标

- 读取方向的内容脱敏由 [dsh-guardian](https://github.com/lonelymoon87/dsh-guardian) 负责。
- 写入时光机（C —— 写入前快照 + 一键回滚）计划在后续里程碑实现。
- 插件永不替代原生审批通道——每个决策都留给你。

## 许可证

[MIT](LICENSE)
