# AGENTS.md — dsh-airbag contributor rules

Rules for AI agents and humans working in this repository.

## Identity

- Package: `dsh-airbag` (bundle id `airbag`, client entry `dsh-airbag-client`).
- License: MIT. Do not add third-party code without keeping its license
  compatible; prefer zero-dependency implementations.

## Copyright policy (mandatory)

- **All open-source projects used are attributed** in
  `THIRD-PARTY-NOTICES.md` — dependencies AND reference implementations.
- **No closed-source project is used**, and no material from
  non-commercial-licensed projects (e.g. CC-BY-NC-SA) is copied: concept
  reference is fine, verbatim code/assets/text is not.
- Any new dependency, copied pattern, or borrowed asset updates
  `THIRD-PARTY-NOTICES.md` in the same commit. Goal: complete
  copyright-risk avoidance.

## Conventions

- TypeScript strict; `verbatimModuleSyntax` on — use `import type` for types.
- Source imports carry the `.ts` extension (`allowImportingTsExtensions`).
- Host logic lives in `src/*.ts`; browser logic lives in `src/client/*.ts`.
- No default exports from plugin entry points — a stray default export
  discards `name` / `inject` / `Config` / `apply` under the Cordis loader.
- Privacy contract: never persist, log, or transmit plaintext secrets.
  Persist masked fragments (`sk-0***cdef`) and SHA-256 prefixes only.
- Notifications: L0–L4 levels, corner-only placement, no focus stealing,
  no sounds by default, respect `prefers-reduced-motion`. All levels and
  dispositions are configured in the settings panel only.

## Workflow

```sh
pnpm run typecheck   # tsc --noEmit
pnpm test            # vitest (host: node env; client: jsdom per-file)
pnpm run build       # tsdown: lib/index.mjs + lib/client.js
pnpm pack            # installable tarball
```

- Every change keeps `typecheck` green and the test suite passing.
- Feature work adds tests: rules in `tests/rules.spec.ts`, store in
  `tests/store.spec.ts`, scan in `tests/scan.spec.ts`, write guard in
  `tests/write-guard.spec.ts`, client behavior in `tests/client.spec.ts`.
- Update `README.md` and `README.zh.md` together.
- Bump `package.json` version when the packed tarball changes behavior.

## Compatibility

- Target DSH plugin API `0.1.0-rc.6` (dsh CLI rc.6, cordis ^4.0.1).
- The HTTP API mounts through `ctx.inject(['webServer'], …)` — never assume
  `ctx.get('webServer')` is ready during `apply`.
- The composer selector list in `src/client/paste-guard.ts` follows the DSH
  Web DOM; host UI changes may require updating `COMPOSER_SELECTORS`.
- Unload must be side-effect free: every listener, node, and style tag is
  owned by a disposer.
