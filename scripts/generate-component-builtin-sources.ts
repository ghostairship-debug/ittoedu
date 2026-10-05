import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { BUILTIN_SOURCE_ENTRIES } from '../src/components/builtin-source/entries'
import type { ComponentImplementation } from '../src/shared/contracts/component-platform/project'

type SourceImplementation = Extract<ComponentImplementation, { kind: 'source' }>
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Bundle actual runtime module closures once at build time, preserving readable source. */
export async function generateComponentBuiltinSources(root = projectRoot): Promise<Record<string, SourceImplementation>> {
  const sources: Record<string, SourceImplementation> = {}
  const bundled = new Map<string, string>()
  for (const [key, entry] of Object.entries(BUILTIN_SOURCE_ENTRIES)) {
    let source = bundled.get(entry)
    if (source === undefined) {
      const result = await build({
        absWorkingDir: root,
        entryPoints: [path.join(root, 'src/components/builtin-source', entry)],
        outfile: 'component.js',
        bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
        write: false, minify: false, treeShaking: true, sourcemap: false,
        charset: 'utf8', legalComments: 'inline',
        // Resolve existing Vite raw imports while building the real module;
        // unused source-view exports are then removed by ordinary tree shaking.
        plugins: [{ name: 'builtin-raw-text', setup(plugin) {
          plugin.onResolve({ filter: /\?raw$/ }, args => ({
            path: path.resolve(path.dirname(args.importer), args.path.slice(0, -4)), namespace: 'builtin-raw-text',
          }))
          plugin.onLoad({ filter: /.*/, namespace: 'builtin-raw-text' }, async args => ({
            contents: await fs.readFile(args.path, 'utf8'), loader: 'text',
          }))
        } }],
      })
      // This artifact is one self-contained ESM source. Do not drop side outputs
      // or silently leave runtime imports dependent on development files.
      if (result.outputFiles.length !== 1 || !result.outputFiles[0].path.endsWith('.js')) {
        throw new Error(`默认组件 ${key} 生成了额外资源；需要实际闭合到其源码实现中。`)
      }
      source = result.outputFiles[0].text
      bundled.set(entry, source)
    }
    sources[key] = { kind: 'source', language: 'javascript', source }
  }
  return sources
}

export async function writeComponentBuiltinSources(root = projectRoot): Promise<void> {
  const sources = await generateComponentBuiltinSources(root)
  const target = path.join(root, 'src/shared/generated/componentBuiltinSources.json')
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, `${JSON.stringify(sources, null, 2)}\n`, 'utf8')
  process.stdout.write(`Generated default component source closures: ${Object.keys(sources).length}\n`)
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  void writeComponentBuiltinSources().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
