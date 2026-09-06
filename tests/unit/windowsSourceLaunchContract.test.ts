import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { windowsSourceLaunchContractIssues } from '../../scripts/windowsSourceLaunchContract'
import { assertLegacyPpt, resaveLegacyPpt } from '../../src/main/pptResave'
import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf8'),
) as { scripts: Record<string, string> }
const doubleClickLauncher = readFileSync(
  resolve(__dirname, '..', '..', '启动课件编辑器.cmd'),
  'utf8',
)

describe('legacy PPT conversion failure isolation', () => {
  it('rejects renamed ZIP files before launching PowerPoint', () => {
    expect(() => assertLegacyPpt(new Uint8Array([0x50, 0x4b]))).toThrow('不是旧版二进制 PPT')
  })
  it('cancels or times out only the conversion worker and cleans its copied input', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ppt-resave-test-'))
    const source = path.join(directory, 'original.ppt'), temporary = path.join(directory, 'temporary')
    const bytes = Buffer.alloc(512); Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(bytes)
    await fs.writeFile(source, bytes)
    const runner = (_script: string, input: string) => {
      expect(input).not.toBe(source)
      return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    }
    try {
      await expect(resaveLegacyPpt(source, temporary, { timeoutMs: 30, run: runner })).rejects.toThrow('超时')
      expect(await fs.readdir(temporary)).toEqual([])
      const controller = new AbortController()
      const pending = resaveLegacyPpt(source, temporary, { signal: controller.signal, run: (...args) => {
        const child = runner(args[0], args[1]); setTimeout(() => controller.abort(), 30); return child
      } })
      await expect(pending).rejects.toThrow('取消')
      expect(await fs.readFile(source)).toEqual(bytes)
      expect(await fs.readdir(temporary)).toEqual([])
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })
})

describe('Windows source launch contract', () => {
  it('keeps npm start aligned with the documented Electron launch properties', () => {
    expect(windowsSourceLaunchContractIssues(packageJson.scripts)).toEqual([])
  })

  it('does not tie the contract to the current TypeScript command runner', () => {
    expect(windowsSourceLaunchContractIssues({
      ...packageJson.scripts,
      start:
        'npm run build:desktop && cross-env VITE_DEV_SERVER_URL= node scripts/launch-electron.js .',
    })).toEqual([])
  })

  it('rejects the old direct Electron launch that bypassed environment cleanup', () => {
    expect(windowsSourceLaunchContractIssues({
      ...packageJson.scripts,
      start: 'npm run build:desktop && cross-env VITE_DEV_SERVER_URL= electron .',
    })).toContain('npm start 未通过共享 Electron 启动入口启动应用')
  })

  it('sanitizes the inherited Electron mode in the double-click launcher too', () => {
    expect(doubleClickLauncher).toContain('set "ELECTRON_RUN_AS_NODE="')
  })
})
