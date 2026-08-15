import { defineConfig } from 'tsdown'

/**
 * dsh-airbag dual-face build:
 * - lib/index.js  — Node ESM host half (loader imports this for the `airbag` row).
 * - lib/client.js — browser CJS bundle registered through the shell's module
 *   loader (`window.__ModuleLoader__.load`); externals resolve from the frozen
 *   platform module table, everything else is inlined.
 */
export default defineConfig([
  {
    name: 'dsh-airbag',
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: true,
    // The cordis framework and runtime deps resolve from the dsh profile tree,
    // never from this repo's install.
    deps: {
      neverBundle: ['@deepseek-ai/cordis', 'schemastery', 'js-yaml'],
    },
  },
  {
    name: 'dsh-airbag/client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    clean: false,
    // Only platform modules stay external; everything else is inlined into the
    // bundle so a require() the loader table cannot answer never happens.
    deps: {
      neverBundle: ['@deepseek-ai/cordis'],
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-airbag", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
