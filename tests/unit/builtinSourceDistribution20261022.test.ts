// @vitest-environment node
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'vite'
import { expect, it } from 'vitest'
import { BUILTIN_SOURCE_ENTRIES } from '../../src/components/builtin-source/entries'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const registry = path.join(root, 'src/shared/generated/componentBuiltinSourceLoaders.ts')
const expectedEntries = [...new Set(Object.values(BUILTIN_SOURCE_ENTRIES))].sort()
const run = promisify(execFile)

// The consumer is a separate native Node process: Vitest's module transforms
// cannot repair a missing production chunk or hide CommonJS/ESM interop errors.
async function readSourceFacts(entry: string, registerTsx = false) {
  const { stdout } = await run(process.execPath, [
    ...(registerTsx ? ['--import', 'tsx'] : []), '--input-type=module', '--eval', `
      // Vite reports rejected dynamic imports through a browser event before
      // rethrowing. Accept that notification so the real import error survives.
      globalThis.window = { dispatchEvent: () => true };
      const { builtinComponentSourceLoaders } = await import(process.argv[1]);
      const facts = await Promise.all(Object.entries(builtinComponentSourceLoaders).map(async ([entry, load]) => {
        const source = await load();
        if (source?.kind !== 'source' || source.language !== 'javascript' ||
            typeof source.source !== 'string' || !source.source.trim()) {
          throw new Error('Invalid builtin source from ' + entry);
        }
        return { entry, sourceLength: source.source.length };
      }));
      process.stdout.write(JSON.stringify(facts));
    `, pathToFileURL(entry).href,
  ], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 45_000 })
  const facts = JSON.parse(stdout) as Array<{ entry: string; sourceLength: number }>
  expect(facts.map(fact => fact.entry).sort()).toEqual(expectedEntries)
  for (const fact of facts) expect(fact.sourceLength, fact.entry).toBeGreaterThan(0)
}

it('loads every real builtin source from Vite production chunks', async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-builtin-vite-'))
  try {
    await build({
      root, configFile: false, logLevel: 'silent',
      build: {
        outDir: output, emptyOutDir: true, minify: false, sourcemap: false,
        // Source-data chunks have no DOM/CSS dependencies. This keeps the
        // production module graph executable by native Node for this test.
        modulePreload: false,
        rollupOptions: {
          input: registry, preserveEntrySignatures: 'strict',
          output: { entryFileNames: 'loaders.mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' },
        },
      },
    })
    await readSourceFacts(path.join(output, 'loaders.mjs'))
  } finally {
    await fs.rm(output, { recursive: true, force: true })
  }
}, 60_000)

it('loads every real builtin source through tsx source consumers', async () => {
  await readSourceFacts(registry, true)
}, 60_000)

it('loads every real builtin source after Main NodeNext compilation', async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-builtin-main-'))
  try {
    const config = path.join(output, 'tsconfig.json')
    await fs.writeFile(config, JSON.stringify({
      extends: path.join(root, 'tsconfig.electron.json'),
      compilerOptions: {
        rootDir: path.join(root, 'src'), outDir: path.join(output, 'compiled'), sourceMap: false,
        typeRoots: [path.join(root, 'node_modules/@types')],
      },
      files: [registry], include: [],
    }))
    await run(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--project', config], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 45_000,
    })
    await readSourceFacts(path.join(output, 'compiled/shared/generated/componentBuiltinSourceLoaders.js'))
  } finally {
    await fs.rm(output, { recursive: true, force: true })
  }
}, 60_000)
