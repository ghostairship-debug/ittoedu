import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { windowsSourceLaunchContractIssues } from '../../scripts/windowsSourceLaunchContract'
import { assertLegacyPpt, resaveLegacyPpt } from '../../src/main/pptResave'
import { promises as fs } from 'node:fs'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { zipSync } from 'fflate'
import os from 'node:os'
import path from 'node:path'

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf8'),
) as { scripts: Record<string, string> }
const doubleClickLauncher = readFileSync(
  resolve(__dirname, '..', '..', '启动果铃工作台.cmd'),
  'utf8',
)

describe('legacy PPT conversion failure isolation', () => {
  it('rejects renamed ZIP files before launching PowerPoint', () => {
    expect(() => assertLegacyPpt(new Uint8Array([0x50, 0x4b]))).toThrow('不是旧版二进制 PPT')
  })
  it('waits for cooperative conversion cleanup on explicit abort and cleans only its copied input', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ppt-resave-test-'))
    const source = path.join(directory, 'original.ppt'), temporary = path.join(directory, 'temporary')
    const bytes = Buffer.alloc(512); Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(bytes)
    await fs.writeFile(source, bytes)
    const cleanup = path.join(directory, 'worker-cleaned')
    const runner = (_script: string, input: string) => {
      expect(input).not.toBe(source)
      // The replacement runner follows the production cancellation marker,
      // including finishing its cleanup before resaveLegacyPpt may return.
      return spawn(process.execPath, ['-e', `
        const fs = require('node:fs'), path = require('node:path');
        const timer = setInterval(() => {
          if (fs.existsSync(path.join(path.dirname(process.argv[1]), 'cancel'))) {
            clearInterval(timer);
            setTimeout(() => { fs.writeFileSync(process.argv[2], 'cleaned'); process.exit(0) }, 30);
          }
        }, 10);
      `, input, cleanup], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    }
    try {
      const controller = new AbortController()
      const pending = resaveLegacyPpt(source, temporary, { signal: controller.signal, run: (...args) => {
        const child = runner(args[0], args[1]); setTimeout(() => controller.abort(), 30); return child
      } })
      await expect(pending).rejects.toThrow('取消')
      expect(await fs.readFile(cleanup, 'utf8')).toBe('cleaned')
      expect(await fs.readFile(source)).toEqual(bytes)
      expect(await fs.readdir(temporary)).toEqual([])
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })
  it('accepts input and output beyond 32 MiB and lets a healthy worker complete after the former 90-second deadline', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ppt-resave-late-'))
    const source = path.join(directory, 'original.ppt'), temporary = path.join(directory, 'temporary')
    const bytes = Buffer.alloc(32 * 1024 * 1024 + 1)
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(bytes)
    await fs.writeFile(source, bytes)
    const converted = zipSync({ 'payload.bin': bytes }, { level: 0 })
    let started!: () => void, output = '', input = ''
    const entered = new Promise<void>(resolve => { started = resolve })
    const worker = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    let settled = false
    const pending = resaveLegacyPpt(source, temporary, { run: (_script, copiedInput, target) => {
      input = copiedInput; output = target; started(); return worker as unknown as ChildProcessWithoutNullStreams
    } })
    void pending.then(() => { settled = true }, () => { settled = true })
    try {
      await entered
      expect(input).not.toBe(source)
      expect((await fs.stat(input)).size).toBe(bytes.length)
      await vi.advanceTimersByTimeAsync(90_001)
      expect(worker.kill).not.toHaveBeenCalled()
      expect(settled).toBe(false)
      await fs.writeFile(output, converted)
      worker.stdout.emit('data', Buffer.from('PPT_RESAVE_OK'))
      worker.emit('close', 0)
      expect(Buffer.from(await pending).equals(Buffer.from(converted))).toBe(true)
      expect((await fs.readFile(source)).equals(bytes)).toBe(true)
      expect(await fs.readdir(temporary)).toEqual([])
    } finally {
      if (!settled) { worker.emit('close', 1); await pending.catch(() => undefined) }
      vi.useRealTimers()
      await fs.rm(directory, { recursive: true, force: true })
    }
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


it('reuses a matching source build and accepts a completed dependency reinstall without manual index deletion', async () => {
  const { pathToFileURL } = await import('node:url')
  const moduleURL = pathToFileURL(resolve('scripts/prepare-source-launch.mjs')).href
  const { prepareSourceLaunch } = await import(moduleURL)
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'source-launch-reuse-'))
  const calls: string[] = []
  await fs.mkdir(path.join(root, 'node_modules'), { recursive: true })
  await fs.writeFile(path.join(root, 'package-lock.json'), 'first lock')
  await fs.writeFile(path.join(root, 'node_modules/.package-lock.json'), 'first installation')
  const outputs: Record<string, string> = { 'build:player:raw': 'dist-player/index.js', 'build:renderer:raw': 'dist-renderer/index.js',
    'build:electron:raw': 'dist-electron/index.js', 'build:clipboard-helper': 'resources/clipboard-file-list/clipboard-file-list.exe',
    'build:file-publish-helper': 'resources/file-publish/file-publish.exe' }
  const run = async (script: string) => {
    calls.push(script)
    if (script === 'generate:component-sources') { const file = path.join(root, 'src/shared/generated/componentBuiltinSourceLoaders.ts'); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.mkdir(path.join(root, 'src/shared/generated/componentBuiltinSources'), { recursive: true }); await fs.writeFile(file, 'generated sources') }
    if (outputs[script]) { const file = path.join(root, outputs[script]); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, 'fixture output') }
  }
  try {
    expect(await prepareSourceLaunch(root, run)).toHaveLength(6)
    expect(calls).toEqual(['generate:component-sources', 'check:built-in-components', 'build:player:raw', 'build:renderer:raw', 'build:electron:raw', 'build:clipboard-helper', 'build:file-publish-helper'])
    calls.length = 0
    expect(await prepareSourceLaunch(root, run, ['renderer'])).toEqual([])
    expect(await prepareSourceLaunch(root, run, ['electron'])).toEqual([])
    const stat = vi.spyOn(fs, 'stat')
    try {
      expect(await prepareSourceLaunch(root, run)).toEqual([])
      for (const input of ['src/shared', 'src/core', 'src/components', 'dist-player', 'node_modules/.package-lock.json']) {
        expect(stat.mock.calls.filter(([filename]) => filename === path.join(root, input))).toHaveLength(1)
      }
    } finally { stat.mockRestore() }
    expect(calls).toEqual([])
    for (const input of ['src/components/text/render.ts', 'scripts/generate-component-builtin-sources.ts', 'src/renderer/interactions/componentInteractionRuntime.ts', 'src/player/surfaces/publishedCourseState.ts']) {
      const file = path.join(root, input)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, 'changed source input')
      expect(await prepareSourceLaunch(root, run)).toEqual(['sources', 'player', 'renderer', 'electron'])
      calls.length = 0
    }
    for (const input of ['index.html', 'document-export.html', 'pptx-import.html', 'compute.html']) {
      await fs.writeFile(path.join(root, input), '<html>new worker input</html>')
      expect(await prepareSourceLaunch(root, run)).toEqual(['renderer'])
      expect(calls).toEqual(['build:renderer:raw'])
      calls.length = 0
      await fs.writeFile(path.join(root, input), '<html>modified worker input</html>')
      expect(await prepareSourceLaunch(root, run)).toEqual(['renderer'])
      expect(calls).toEqual(['build:renderer:raw'])
      calls.length = 0
    }
    await fs.writeFile(path.join(root, 'dist-electron/index.js'), 'tampered output')
    expect(await prepareSourceLaunch(root, run, ['renderer'])).toEqual([])
    expect(await prepareSourceLaunch(root, run, ['electron'])).toEqual(['electron'])
    calls.length = 0
    await fs.writeFile(path.join(root, 'package-lock.json'), 'new requested lock')
    await expect(prepareSourceLaunch(root, run)).rejects.toThrow('npm ci')
    expect(calls).toEqual([])
    await fs.writeFile(path.join(root, 'node_modules/.package-lock.json'), 'updated installed lock after reinstall')
    expect(await prepareSourceLaunch(root, run)).toEqual(['sources', 'player', 'renderer', 'electron'])
    expect(await prepareSourceLaunch(root, run)).toEqual([])
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
