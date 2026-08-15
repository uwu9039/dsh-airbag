# Third-Party Notices

dsh-airbag is licensed under [MIT](LICENSE). This file lists every open-source
dependency, tool, and reference implementation this project builds on, so
attribution is complete and no closed-source material is used anywhere.

## License policy

- **All open source is attributed** — every dependency and every reference
  implementation appears below.
- **No closed-source material is used** — runtime dependencies, build tooling,
  and reference patterns are all MIT / Apache-2.0 licensed, with one
  non-commercial reference (Maid Atelier, see below) used for *conceptual*
  build guidance only: no code, assets, or text from it appear in this
  repository.
- **Goal: complete copyright-risk avoidance** — if you add a dependency or
  copy a pattern, update this file in the same commit.

## Runtime dependencies

| Package | License | Purpose |
|---|---|---|
| [@deepseek-ai/cordis](https://github.com/cordiverse/cordis) | MIT | Plugin framework / context (peer) |
| [@deepseek-ai/schemastery](https://github.com/cordiverse/schemastery) | MIT | Config schema validation (peer) |
| [js-yaml](https://github.com/nodeca/js-yaml) | MIT | rules.yaml parsing |

## Development dependencies

| Package | License |
|---|---|
| [tsdown](https://github.com/rolldown/tsdown) | MIT |
| [vitest](https://github.com/vitest-dev/vitest) | MIT |
| [typescript](https://github.com/microsoft/TypeScript) | Apache-2.0 |
| [jsdom](https://github.com/jsdom/jsdom) | MIT |
| [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped) | MIT |

## Reference implementations (patterns only, not copied verbatim)

| Project | License | What this project takes from it |
|---|---|---|
| [dsh-guardian](https://github.com/lonelymoon87/dsh-guardian) | MIT | The `tools/pre-execute` waterfall listener shape (`(exec, next)` → `deny`/`ask`), and the idea of extracting command-bearing argument keys before scanning |
| [DeepSeek Harness official docs](https://deepseek-harness.github.io/deepseek-harness/) | MIT (repo) | Plugin manifest (`dsh.bundle` / `dsh.client`), Cordis plugin shape, webserver route registration, settings seam semantics |
| [omdsh-dev/plugin-template](https://github.com/omdsh-dev/plugin-template) | MIT | Repository layout conventions (src/index.ts vs src/config.ts vs src/runtime.ts split) |
| [Maid Atelier](https://github.com/Small-tailqwq/maid-atelier) | CC-BY-NC-SA-4.0 | **Conceptual only**: the idea that a bundle ships a Node half + a browser half registered via `window.__ModuleLoader__.load`. No code, CSS, assets, or text from Maid Atelier is included; the non-commercial license is therefore not engaged |

## Iconography

The 🛡️ and other emoji used in the UI are Unicode emoji (Unicode Consortium
license, free to use); no icon font or image assets are bundled.

---

*This file must be updated whenever dependencies or reference material change.*
