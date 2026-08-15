# dsh-airbag 发布指南（PUBLISHING）

按官方文档规范发布到 npm / GitHub，并收录进社区插件列表。

参考文档：
- 官方打包与安装教程：[Package and install a plugin](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish)（bundle / profile / `dsh plugin add`）
- 社区插件列表：[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)（收录通过 PR）
- Cordis 教程：[cordis-tutorial](https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/01-first-plugin) 与 [Configuration](https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/05-config)

---

## 0. 发布前检查清单（Preflight）

- [ ] `npm` 包名可用：`dsh-airbag` 在 npmjs 上**未被占用**（2026-08-15 实测 `registry.npmjs.org/dsh-airbag` 返回 404）。发布前再查一次：
  ```sh
  npm view dsh-airbag version   # 报 404 / E404 = 可用
  ```
- [ ] `package.json` 无 `"private": true`（已移除；npm 会拒绝发布 private 包）
- [ ] `description` 与 `keywords` 准确（已含 dsh / security / secret-detection 等关键词）
- [ ] 许可证与第三方声明：`LICENSE`（MIT）+ `THIRD-PARTY-NOTICES.md` 最新；**任何新增依赖或参考实现必须同步更新 NOTICES**
- [ ] 版本号：`package.json` 与 tarball 一致（当前 0.4.0）；行为变化按 `AGENTS.md` 约定 bump 版本
- [ ] 构建产物：`lib/` 已由 `prepare` 脚本（tsdown）在 `pnpm install` / `pnpm publish` 时自动生成，无需手动提交

## 1. 本地验证（每次发布前必须全绿）

```sh
pnpm run typecheck   # tsc --noEmit
pnpm test            # vitest：7 个 spec，46 个用例
pnpm run build       # tsdown：lib/index.mjs + lib/client.js
pnpm pack            # 产出 dsh-airbag-<version>.tgz
```

安装到本地 profile 冒烟：

```sh
dsh plugin --profile web add ./dsh-airbag-0.4.2.tgz
dsh --profile web --dump-config   # 应看到 "# == dsh-airbag" 层
# 重启 DSH Web 后按 README「重启后请验证」逐条验收
```

卸载验证零残留：`dsh plugin --profile web remove dsh-airbag`

## 2. 发布到 npm（推荐：用户可直接 `dsh plugin add dsh-airbag`）

```sh
# 登录（注意：若本机默认 registry 是镜像，必须显式指定官方源）
npm login --registry=https://registry.npmjs.org

# 发布（prepare 脚本会自动构建 lib/；files 白名单只打包 lib、cordis.patch.yml、README、LICENSE 等）
npm publish --registry=https://registry.npmjs.org
# 或 pnpm publish --registry=https://registry.npmjs.org
```

发布后验证：

```sh
npm view dsh-airbag            # 能看到元数据
dsh plugin --profile web add dsh-airbag   # 全新机器上可直接安装
```

> 注意：`pnpm publish` 会先跑 `prepare`（tsdown 构建）。若发布时网络走镜像失败，检查 `npm config get registry`。

## 3. 发布到 GitHub

1. 建仓库（如 `your-name/dsh-airbag`），推送本目录全部内容（`node_modules/`、`lib/`、`*.tgz`、`_docs/` 已被 `.gitignore` 排除）。
2. 给仓库加 **`dsh-plugin`** topic（[topics/dsh-plugin](https://github.com/topics/dsh-plugin)），便于社区发现。
3. 用户可直接 `dsh plugin --profile web add github:your-name/dsh-airbag#<commit-sha>`；本仓库的 `prepare` 脚本保证 git 安装时自动构建。用户首次安装需在 profile 的 `pnpm-workspace.yaml` 中授权：
   ```yaml
   allowBuilds:
     dsh-airbag: true
   ```
   （详见官方 publish 教程「Installing from GitHub: the build-script catch」。若不想让用户授权，就发布 npm 或 tarball。）

## 4. 收录进 awesome-dsh-plugin（社区列表）

仓库：[awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)

- 提 PR：在 `README.md` 与 `README.zh.md` 的**对应分类**下各加一行，格式：
  ```markdown
  - [your-name/dsh-airbag](https://github.com/your-name/dsh-airbag) — 一句话描述
  ```
- 分类建议：**🧑‍💻 开发与运行时**（现有安全类插件 dsh-guardian / dsh-security-audit / dsh-fleet-audit 均在此分类）。
- 描述示例（中）：
  `非侵入式安全护栏：拦截粘贴/写入给 Agent 的 API 密钥、泄露追踪、审批盲批检测与工作区安全体检。`
- 收录后可在 README 挂徽章：
  ```markdown
  [![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
  ```

## 5. 维护约定（防侵权 / 合规红线）

- 代码必须原创：可参考 MIT/Apache-2.0 项目的**模式**，但不得复制代码、资产或文案；非商业许可（CC-BY-NC-SA 等）项目连模式引用都要在 NOTICES 中声明。
- 每次新增依赖 / 借用模式，同一提交内更新 `THIRD-PARTY-NOTICES.md`（依赖 + 参考实现两张表）。
- 明文密钥永不落盘 / 不进日志 / 不进遥测（仓库隐私契约，见 `AGENTS.md`）。
- README.md 与 README.zh.md 必须同步更新。
- 发布新版本前跑完第 1 节全部命令，并 bump `package.json` 版本。


