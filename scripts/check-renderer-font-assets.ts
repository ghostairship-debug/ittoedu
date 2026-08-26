/**
 * Assert the renderer build emitted every bundled font slice as its own file.
 *
 * Why this needs its own gate: the export path reads font bytes with `fetch()`,
 * which the editor CSP governs through `connect-src`, and that directive does
 * not allow `data:`. An inlined slice therefore still renders in the editor but
 * cannot be read back, and the all-or-nothing family rule turns one inlined
 * slice into a whole family that silently never embeds. `vite.renderer.config.ts`
 * exempts `woff2` from `assetsInlineLimit` for exactly that reason, and that one
 * line is the entire defence — a regression there passes typecheck, passes every
 * Vitest suite, and only shows up in an exported lesson on another machine.
 *
 * Run after `npm run build:renderer`. Compares the emitted assets against the
 * slices the manifest declares, by content, so the check cannot be satisfied by
 * the wrong 102 files.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bundledFontFaceSpecifiers,
  resolveBundledFontDescriptors,
} from '../src/shared/fonts/bundledFontSources'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nodeModules = join(repositoryRoot, 'node_modules')
const rendererOutput = join(repositoryRoot, 'dist-renderer')

/** Both spellings a bundler may produce for an inlined `woff2`. */
const INLINED_FONT = /data:(?:font\/woff2?|application\/font-woff2?)/iu

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function filesUnder(directory: string, predicate: (name: string) => boolean): string[] {
  const found: string[] = []
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const next = join(current, entry.name)
      if (entry.isDirectory()) visit(next)
      else if (entry.isFile() && predicate(entry.name)) found.push(next)
    }
  }
  visit(directory)
  return found
}

function main(): void {
  if (!existsSync(rendererOutput) || !statSync(rendererOutput).isDirectory()) {
    throw new Error(
      `找不到 renderer 构建产物：${rendererOutput}。请先运行 npm run build:renderer。`,
    )
  }

  const specifiers = bundledFontFaceSpecifiers(resolveBundledFontDescriptors(nodeModules))
  const expected = new Map<string, string>()
  for (const specifier of specifiers) {
    expected.set(digest(readFileSync(join(nodeModules, specifier))), specifier)
  }
  if (expected.size !== specifiers.length) {
    throw new Error(
      `内置字体清单里有内容相同的切片：${specifiers.length} 个声明只有 ${expected.size} 份不同内容`,
    )
  }

  const emitted = filesUnder(rendererOutput, (name) => /\.woff2?$/iu.test(name))
  const emittedDigests = new Set(emitted.map((path) => digest(readFileSync(path))))

  const missing = [...expected]
    .filter(([hash]) => !emittedDigests.has(hash))
    .map(([, specifier]) => specifier)
  if (missing.length > 0) {
    throw new Error(
      `renderer 产物缺少 ${missing.length} 个字体切片，很可能被内联进了 JS/CSS：\n  ${
        missing.slice(0, 5).join('\n  ')
      }${missing.length > 5 ? `\n  …共 ${missing.length} 个` : ''}`,
    )
  }

  const inlined = filesUnder(rendererOutput, (name) => /\.(?:js|css)$/iu.test(name))
    .filter((path) => INLINED_FONT.test(readFileSync(path, 'utf8')))
    .map((path) => path.slice(repositoryRoot.length + 1).replaceAll('\\', '/'))
  if (inlined.length > 0) {
    throw new Error(
      `renderer 产物把字体内联成了 data: URI，导出路径将读不到字节：\n  ${inlined.join('\n  ')}`,
    )
  }

  console.log(
    `OK\t内置字体切片全部作为独立文件产出\t声明 ${specifiers.length} 个 / 产出 ${emitted.length} 个`,
  )
}

main()
