// @vitest-environment node
import { mkdtemp, mkdir, open, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { buildCoursewareCase } from '../../scripts/build-courseware-case'
import type { CoursewareCaseBuilderContextV2 } from '../../scripts/courseware-builder-v2-host'

it('supplies V2 binary asset helpers and rejects lexical and linked escapes before delivery', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'courseware-v2-assets-'))
  try {
    const caseDir = path.join(root, '课例 #1'), outside = path.join(root, 'outside')
    await mkdir(path.join(caseDir, '素材'), { recursive: true })
    await mkdir(outside)
    const source = new Uint8Array([0, 255, 128, 65])
    await writeFile(path.join(caseDir, '素材', '图 #1.bin'), source)
    await writeFile(path.join(outside, 'outside.bin'), source)
    await symlink(outside, path.join(caseDir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    for (const filename of ['build.mjs', '01.md', '02.md']) await writeFile(path.join(caseDir, filename), '# fixture')
    const oversized = await open(path.join(caseDir, 'large.bin'), 'w')
    try { await oversized.truncate(32 * 1024 * 1024 + 1) } finally { await oversized.close() }
    const completed = new Error('asset assertions complete; no delivery requested')
    let checked = false
    await expect(buildCoursewareCase({
      caseDir, builder: 'build.mjs', teachingPlan: '01.md', presentationScript: '02.md',
      project: 'out.h5lesson', html: 'out.html', force: false,
    }, {
      editorRoot: path.resolve(__dirname, '../..'),
      playerBundle: 'window.CoursewarePlayer={mount(){}};',
      importBuilder: async () => ({ apiVersion: 2, default: async (context: CoursewareCaseBuilderContextV2) => {
        expect(context.apiVersion).toBe(2)
        const bytes = await context.readAsset('素材/图 #1.bin')
        expect(bytes).toBeInstanceOf(Uint8Array)
        expect([...bytes]).toEqual([...source])
        expect(context.encodeBase64(bytes)).toBe('AP+AQQ==')
        expect(context.encodeBase64('电路✓')).toBe('55S16Lev4pyT')
        bytes[0] = 99
        expect([...await context.readAsset('素材/图 #1.bin')]).toEqual([...source])
        await expect(context.readAsset('../outside/outside.bin')).rejects.toThrow('逃逸课例目录')
        await expect(context.readAsset(path.join(outside, 'outside.bin'))).rejects.toThrow('相对路径')
        await expect(context.readAsset('linked/outside.bin')).rejects.toThrow('逃逸课例目录')
        await expect(context.readAsset('素材')).rejects.toThrow('不是文件')
        await expect(context.readAsset('missing.bin')).rejects.toThrow('不存在')
        await expect(context.readAsset('large.bin')).rejects.toThrow('32 MiB')
        checked = true
        throw completed
      } }),
    })).rejects.toBe(completed)
    expect(checked).toBe(true)
    await expect(readFile(path.join(caseDir, 'out.h5lesson'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path.join(caseDir, 'out.html'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
}, 30_000)
