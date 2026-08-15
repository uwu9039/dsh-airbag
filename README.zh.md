# dsh-airbag

DeepSeek Harness 的非侵入式安全护栏：拦截粘贴给 Agent 的 API 密钥、写入拦截、泄露追踪与首次安全体检。

Non-intrusive safety belt for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): blocks API keys pasted to the agent, tracks leak events, blocks secret writes, and offers a first-run workspace health scan.

## 功能

- **粘贴拦截（A1）**——向输入框粘贴密钥（DeepSeek/OpenAI/Anthropic key、AWS、GitHub PAT、JWT、PEM 私钥块、阿里云/腾讯云 AccessKey 等 45+ 内置模式）时，按你的设置**阻止 / 脱敏 / 警告**。判定在粘贴事件内同步完成，任何内容都不会被发给模型。
- **写入拦截（A2）**——模型写方向工具调用（`write` / `edit` / `bash` / `run_code`）的参数携带密钥时，直接 **deny 阻止**，或转**原生审批通道**（`ask`）——确认永远由 harness UI 弹出，绝不绕过。
- **审批疲劳洞察（B）**——原生审批链上的纯观察者：从不决策，只测量"请求→决策"耗时，标记**盲批**（<2s 内批准 = 无脑点确认）与**疲劳发作**（30 分钟内密集且近乎全批）。洞察以普通事件落入记录流。
- **边角通知中心（G1）**——四级非侵入通知：L0 完全静默、L1 仅徽章计数、L2 右下角 toast（自动消失、无音效、不抢焦点）、L3 常驻徽章。同类事件 5 分钟窗口内自动聚合；全局勿扰开关一键隐藏所有浮层。
- **首次安全体检（G6）**——只读扫描工作区：`.env`、凭据文件、内嵌密钥、git remote 内嵌凭据。只报告脱敏片段，不保存文件内容。
- **隐私内建**——明文密钥永不落盘、不进日志、不进遥测：只持久化脱敏片段（`sk-0***cdef`）与 SHA-256 前缀，全部位于 `~/.dsh/airbag/`。

## 安装

```sh
dsh plugin --profile web add dsh-airbag          # npm 发布后可用
dsh plugin --profile web add ./dsh-airbag-0.4.2.tgz   # tarball 安装
dsh plugin --profile web add github:owner/dsh-airbag  # 源码安装（需要 allowBuilds 授权）
```

重启 DSH Web 后，右下角会出现 🛡️ **Airbag** 按钮（首次运行带"1"徽章 = 体检邀请）。

## 使用

点击 🛡️ 打开面板，三个页签：

| 页签 | 作用 |
|---|---|
| 拦截记录 | 今日拦截：时间、类别、动作、脱敏片段；可清空 |
| 体检 | 输入工作区路径，执行只读安全体检 |
| 设置 | 默认处置（阻止/脱敏/警告）、各类事件通知级别（L0–L4）、勿扰、音效、白名单、自定义正则规则（rules.yaml） |

**所有级别与处置配置的唯一入口是设置页签**——通知浮层不提供任何现场切换。

自定义规则写入 `~/.dsh/airbag/rules.yaml`（YAML 列表）：

```yaml
- pattern: 'INT_[A-Z0-9]{12}'
  label: 内网 Token
  action: block
  severity: high
  notice: 3
```

## 配置

插件支持 `cordis.yml` 行内 `config` 块（全部可选）：

```yaml
- id: airbag
  name: dsh-airbag
  config:
    dataDir: ~/.dsh/airbag        # 数据目录（事件/配置/规则）
    defaultAction: block          # block | redact | warn
    maxPasteBytes: 10240          # 粘贴扫描上限（字节）
    maxScanFileBytes: 262144      # 体检单文件扫描上限
    maxScanFiles: 200             # 体检内容扫描文件数上限
```

## 开发

要求：Node.js `^22.19 || >=24`、pnpm。

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm pack    # 产出 dsh-airbag-0.4.2.tgz
```

本地验证：

```sh
pnpm run build
dsh plugin --profile web add ./dsh-airbag-0.4.2.tgz
dsh --profile web
```

## 架构

```
src/index.ts             Host 插件入口：事件存储、设置文件、体检、A2 写入拦截、HTTP API
src/rules.ts             纯密钥检测引擎（45+ 内置模式、自定义规则、白名单）
src/store.ts             Append-only JSONL 事件存储
src/config.ts            部署 Config schema + 用户设置文件（config.json / rules.yaml）
src/scan.ts              只读工作区安全体检
src/write-guard.ts       A2 写方向判定引擎（pre-execute 载荷扫描）
src/approval-insight.ts  B 审批疲劳观察者（盲批/疲劳检测，纯逻辑）
src/routes.ts            /dsh-airbag/api/* HTTP 路由（仅 web profile，经 ctx.inject(['webServer'])）
src/client/index.ts      Web 客户端入口：挂载粘贴守卫 + 通知中心 + 面板
src/client/paste-guard.ts  A1 粘贴拦截（限定输入框、同步决策）
src/client/notify.ts     G1 边角通知中心（四级、聚合、勿扰）
src/client/panel.ts      面板 UI（记录 / 体检 / 设置）
```

Host 与浏览器端通过同源 `/dsh-airbag/api/*` 路由通信，不增加额外 RPC 面。A2 写入拦截挂在官方 `tools/pre-execute` waterfall 上，返回 `deny` / `ask` 决策；浏览器端每 30s 轮询事件 API，宿主侧拦截会以徽章更新浮现。

## 非目标

- 读方向脱敏有意交给 [dsh-guardian](https://github.com/lonelymoon87/dsh-guardian)。
- 写入时光机（C：写入前快照 + 一键回滚）计划在后续版本。
- 插件永不替代原生审批机制——每个决策都留给你。

## License

[MIT](LICENSE)





