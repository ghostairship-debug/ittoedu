// @vitest-environment node

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LESSON_AUTHORING_METHOD_PATHS } from '../../src/main/lessonAuthoringPrompt'

const root = path.resolve(__dirname, '..', '..')

/**
 * 打包清单门禁。
 *
 * 背景：软件内创作流程在运行时用 `fs.readFile(path.join(app.getAppPath(), <仓库相对路径>))`
 * 读取方法文件。`electron-builder.yml` 的 `files` 是显式白名单，未列出的路径不会进入
 * app.asar；`scripts/verify-release.ts` 的「发布配套文件」只检查源码仓库里存在这些文件，
 * 不检查打包产物内部，所以缺文件时发布校验仍会通过，直到打包版真正跑创作流程才 ENOENT。
 * 这里把「运行时读取的路径必须被打包清单覆盖」变成可跑断言。
 */

/**
 * 把 electron-builder 的 files 模式转成正则：`**` 跨目录，`*` 不跨目录。
 * 负向模式（`!` 前缀）由 `coveredBy` 处理，这里只编译正向模式。
 */
function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split('')
    .map((char) => {
      if ('\\^$.|?+()[]{}'.includes(char)) return `\\${char}`
      return char
    })
    .join('')
  return new RegExp(`^${escaped.split('**').join('\u0000').split('*').join('[^/]*').split('\u0000').join('.*')}$`)
}

/**
 * electron-builder（app-builder-lib 的 FileMatcher）按顺序匹配、**后匹配者胜**：
 * 负向模式 `!x` 会把已包含的路径重新排除。只累加正向模式会让
 * `['.agents/**', '!.agents/x/**']` 里的 `x` 被误判为「已覆盖」——
 * 打包版随后在读取时 ENOENT。这里按同一语义求最终结论。
 */
function coveredBy(patterns: string[], relativePath: string): boolean {
  let included = false
  for (const pattern of patterns) {
    const negated = pattern.startsWith('!')
    const body = negated ? pattern.slice(1) : pattern
    if (!patternToRegExp(body).test(relativePath)) continue
    included = !negated
  }
  return included
}

async function readPackagedFilePatterns(): Promise<string[]> {
  const manifest = await readFile(path.join(root, 'electron-builder.yml'), 'utf8')
  const lines = manifest.split('\n')
  const start = lines.findIndex((line) => /^files:\s*$/.test(line))
  if (start < 0) throw new Error('electron-builder.yml 缺少 files 清单')
  const patterns: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break
    const match = /^\s*-\s+(?:"([^"]+)"|(\S+))\s*$/.exec(line)
    if (match) patterns.push(match[1] ?? match[2]!)
  }
  if (patterns.length === 0) throw new Error('electron-builder.yml 的 files 清单为空')
  return patterns
}

function uncovered(patterns: string[], relativePaths: string[]): string[] {
  return relativePaths.filter((relativePath) => !coveredBy(patterns, relativePath))
}

describe('packaged runtime file boundary', () => {
  it('matches glob patterns the way electron-builder does', () => {
    // 反例控制：确保匹配器不是「永远为真」，否则下面的断言会空过。
    expect(patternToRegExp('.agents/**').test('.agents/skills/orchestrate-courseware/references/main-progression.md')).toBe(true)
    expect(patternToRegExp('.agents/**').test('dist-electron/main/index.js')).toBe(false)
    expect(patternToRegExp('resources/icons/**').test('resources/icons/icon.png')).toBe(true)
    expect(patternToRegExp('resources/icons/**').test('resources/icons/nested/icon.png')).toBe(true)
    expect(patternToRegExp('resources/icons/*').test('resources/icons/nested/icon.png')).toBe(false)
    expect(patternToRegExp('package.json').test('package.json')).toBe(true)
    expect(patternToRegExp('package.json').test('package.json.bak')).toBe(false)
  })

  it('covers every path the app reads from app.getAppPath() at runtime', async () => {
    const patterns = await readPackagedFilePatterns()
    // 这些路径逐条来自源码中的真实读取点：
    //   src/main/lessonAuthoringPrompt.ts:18  → LESSON_AUTHORING_METHOD_PATHS
    //   src/main/createWindow.ts:32           → resources/icons/icon.png
    //   src/main/protocols.ts:25              → dist-renderer
    const required = [
      ...new Set(Object.values(LESSON_AUTHORING_METHOD_PATHS)),
      'resources/icons/icon.png',
      'dist-renderer/index.html',
    ]
    expect(required.length).toBeGreaterThan(0)
    expect(uncovered(patterns, required)).toEqual([])
  })

  it('ships a non-empty copy of every authoring method file', async () => {
    const methods = [...new Set(Object.values(LESSON_AUTHORING_METHOD_PATHS))]
    expect(methods.length).toBeGreaterThan(0)
    for (const method of methods) {
      const stats = await stat(path.join(root, ...method.split('/')))
      expect(stats.isFile(), method).toBe(true)
      expect(stats.size, method).toBeGreaterThan(0)
    }
  })

  it('keeps the file boundary honest about a path that is not packaged', async () => {
    // 反例：这个路径确实被源码读取（componentCatalogManager.ts:90，位于 app 根之外），
    // 因此不在 files 白名单内，必须由 uncovered 报出而不是被静默放过。
    const patterns = await readPackagedFilePatterns()
    expect(uncovered(patterns, ['courseware-components/index.json'])).toEqual(['courseware-components/index.json'])
  })

  it('treats a later negative pattern as an exclusion, the way electron-builder does', () => {
    // 反例控制：`uncovered` 不能只看正向模式。M5 变异（在 `- .agents/**` 后追加
    // `- "!.agents/skills/build-courseware-project/**"`）下旧实现仍报 0 个未覆盖，
    // 而打包版读 build-method.md 会 ENOENT。
    expect(uncovered(['.agents/**'], ['.agents/skills/build-courseware-project/references/build-method.md'])).toEqual([])
    expect(uncovered(
      ['.agents/**', '!.agents/skills/build-courseware-project/**'],
      ['.agents/skills/build-courseware-project/references/build-method.md'],
    )).toEqual(['.agents/skills/build-courseware-project/references/build-method.md'])
    // 后匹配者胜：负向模式之后再出现正向模式应重新包含。
    expect(uncovered(
      ['.agents/**', '!.agents/**', '.agents/skills/**/references/*.md'],
      ['.agents/skills/orchestrate-courseware/references/main-progression.md'],
    )).toEqual([])
  })

  it('never packages machine-local state or files outside the runtime read set', async () => {
    // 整目录 `.agents/**` 会把被 gitignore 的 editor-root.local.json（内含构建机
    // 绝对路径）打进 app.asar：本机发布边界扫描必然失败，换构建机则静默随包发布。
    // 这里要求打包清单既不覆盖该文件，也不覆盖运行时读取集之外的 .agents 内容。
    const patterns = await readPackagedFilePatterns()
    const mustNotShip = [
      '.agents/skills/build-courseware-project/editor-root.local.json',
      '.agents/skills/build-courseware-project/references/external-case-build.md',
      '.agents/skills/orchestrate-courseware/SKILL.md',
    ]
    expect(mustNotShip.filter((relativePath) => coveredBy(patterns, relativePath))).toEqual([])
    // 反向控制：运行时读取集必须仍然被覆盖，否则上一条断言会因清单为空而空过。
    expect(uncovered(patterns, [...new Set(Object.values(LESSON_AUTHORING_METHOD_PATHS))])).toEqual([])
  })
})
