// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WordLayoutRuntime, WORD_LAYOUT_RELEASE, createWordPreviewConverter } from '../../src/main/workbench/office/WordLayoutRuntime'
import type { runPythonProcess } from '../../src/main/workbench/compute/nativePythonProcess'
import { WordPreviewError } from '../../src/main/workbench/office/WordPreviewError'

const roots: string[] = []
const success = { code: 0, stdout: 'LibreOffice 26.2.4.2 example-build\n', stderr: '' }
async function root() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-word-runtime-test-'))
  roots.push(directory)
  return directory
}
afterEach(async () => { await Promise.all(roots.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))) })

describe('local Word layout runtime boundary', () => {
  it('uses a working installed runtime without downloading or altering its profile', async () => {
    const directory = await root(), download = vi.fn(), executable = path.join(directory, 'existing soffice.com')
    const calls: Array<{ executable: string; args: readonly string[] }> = []
    const run: typeof runPythonProcess = async (file, args) => {
      calls.push({ executable: file, args })
      if (file !== executable) throw new Error('missing candidate')
      return success
    }
    const runtime = new WordLayoutRuntime({ directory, candidates: ['missing', executable], download, run })
    expect(await runtime.ensure(new AbortController().signal)).toEqual({ executable, version: '26.2.4.2' })
    expect(download).not.toHaveBeenCalled()
    expect(calls.every(call => call.args.includes('--version'))).toBe(true)
    expect(await fs.readdir(directory)).toEqual([])
  })

  it('reuses a prepared local runtime on a cold instance while the network is unavailable', async () => {
    const directory = await root(), executable = path.join(directory, `libreoffice-${WORD_LAYOUT_RELEASE.version}`, 'App', 'libreoffice', 'program', 'soffice.com')
    await fs.mkdir(path.dirname(executable), { recursive: true }); await fs.writeFile(executable, 'fixture executable')
    const download = vi.fn(async () => { throw new Error('offline') })
    const run: typeof runPythonProcess = async file => file === executable ? success : { code: 1, stdout: '', stderr: 'unavailable' }
    const runtime = new WordLayoutRuntime({ directory, candidates: [], download, run })
    await expect(runtime.ensure(new AbortController().signal)).resolves.toEqual({ executable, version: '26.2.4.2' })
    expect(download).not.toHaveBeenCalled()
  })

  it('reports the actual current version after an installed executable is upgraded at the same path', async () => {
    const directory = await root()
    let version = '26.2.4.2'
    const run: typeof runPythonProcess = async () => ({ code: 0, stdout: `LibreOffice ${version}\n`, stderr: '' })
    const runtime = new WordLayoutRuntime({ directory, candidates: ['existing-soffice'], run })
    expect((await runtime.ensure(new AbortController().signal)).version).toBe('26.2.4.2')
    version = '26.2.7.2'
    expect((await runtime.ensure(new AbortController().signal)).version).toBe('26.2.7.2')
  })

  it.skipIf(process.platform !== 'win32' || process.arch !== 'x64')('rejects a corrupted published archive before extraction and removes its preparation directory', async () => {
    const directory = await root(), run = vi.fn<typeof runPythonProcess>()
    const extractorPath = path.join(directory, 'shipped-7z.exe')
    await fs.writeFile(extractorPath, 'mock extractor file')
    const download = vi.fn(async () => new Response('not the published runtime'))
    const runtime = new WordLayoutRuntime({ directory, candidates: [], extractorPath, download, run })
    await expect(runtime.ensure(new AbortController().signal)).rejects.toThrow('校验失败')
    expect(download).toHaveBeenCalledWith(WORD_LAYOUT_RELEASE.url, expect.any(AbortSignal))
    expect(run).not.toHaveBeenCalled()
    expect(await fs.readdir(directory)).toEqual(['shipped-7z.exe'])
  })

  it.skipIf(process.platform !== 'win32' || process.arch !== 'x64')('reports a missing shipped extractor before starting any download', async () => {
    const directory = await root(), download = vi.fn(), run = vi.fn<typeof runPythonProcess>()
    const runtime = new WordLayoutRuntime({ directory, candidates: [], extractorPath: path.join(directory, 'missing-7z.exe'), download, run })
    await expect(runtime.ensure(new AbortController().signal)).rejects.toMatchObject({ code: 'component' })
    expect(download).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(await fs.readdir(directory)).toEqual([])
  })

  it('stops a queued caller without cancelling another active runtime probe', async () => {
    const directory = await root(), first = new AbortController(), queued = new AbortController()
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const run: typeof runPythonProcess = async () => { await pending; return success }
    const runtime = new WordLayoutRuntime({ directory, candidates: ['existing-soffice'], run })
    const active = runtime.ensure(first.signal)
    const waiting = runtime.ensure(queued.signal)
    queued.abort(new Error('closed queued tab'))
    await expect(waiting).rejects.toThrow('closed queued tab')
    expect(first.signal.aborted).toBe(false)
    release()
    await expect(active).resolves.toMatchObject({ version: '26.2.4.2' })
  })

  it('converts only the supplied snapshot path with its own profile and no shell argument quoting', async () => {
    const directory = await root(), sourcePath = path.join(directory, '临时 原件.docx')
    const outputDirectory = path.join(directory, '渲染 输出'), profileDirectory = path.join(directory, '隔离 profile')
    await fs.mkdir(outputDirectory); await fs.mkdir(profileDirectory)
    const runtime = new WordLayoutRuntime({ directory, candidates: ['existing-soffice'], run: async () => success })
    const signal = new AbortController().signal
    const run: typeof runPythonProcess = async (executable, args, options) => {
      expect(executable).toBe('existing-soffice')
      expect(args).toContain(sourcePath)
      expect(args).toContain(outputDirectory)
      expect(args).toContain('pdf:writer_pdf_Export')
      const profileArgument = args.find(arg => arg.startsWith('-env:UserInstallation='))!
      expect(fileURLToPath(profileArgument.slice('-env:UserInstallation='.length))).toBe(profileDirectory)
      expect(options?.signal).toBe(signal)
      const profile = await fs.readFile(path.join(profileDirectory, 'user', 'registrymodifications.xcu'), 'utf8')
      expect(profile).toMatch(/DisableMacrosExecution[^]*?<value>true<\/value>/)
      expect(profile).toMatch(/Office.Writer\/Content\/Update[^]*?oor:name="Link"[^]*?<value>0<\/value>/)
      return { code: 0, stdout: '', stderr: '' }
    }
    await expect(createWordPreviewConverter(runtime, { run })({ sourcePath, outputDirectory, profileDirectory, signal }))
      .resolves.toEqual({ engine: { name: 'LibreOffice', version: '26.2.4.2' } })
  })

  it('reports conversion failure without leaking process output and preserves cancellation', async () => {
    const directory = await root(), profileDirectory = path.join(directory, 'profile')
    await fs.mkdir(profileDirectory)
    const runtime = new WordLayoutRuntime({ directory, candidates: ['existing-soffice'], run: async () => success })
    const input = { sourcePath: 'document.docx', outputDirectory: directory, profileDirectory }
    const convert = createWordPreviewConverter(runtime, { run: async () => ({ code: 1, stdout: '', stderr: 'private/path secret' }) })
    const failure = await convert(input).catch(error => error)
    expect(failure).toBeInstanceOf(WordPreviewError)
    expect(failure.code).toBe('conversion')
    expect(failure.message).not.toContain('private/path')
    const controller = new AbortController(), reason = new Error('cancel reason')
    const cancelled = createWordPreviewConverter(runtime, { run: async () => { controller.abort(reason); throw new Error('process ended') } })
    await expect(cancelled({ ...input, signal: controller.signal })).rejects.toBe(reason)
  })

  it.skipIf(process.platform !== 'win32' || process.arch !== 'x64')('classifies a network failure without exposing its details', async () => {
    const directory = await root()
    const extractorPath = path.join(directory, '7z.exe')
    await fs.writeFile(extractorPath, 'mock extractor file')
    const runtime = new WordLayoutRuntime({ directory, candidates: [], extractorPath,
      download: async () => { throw new Error('private network detail') } })
    const failure = await runtime.ensure(new AbortController().signal).catch(error => error)
    expect(failure).toBeInstanceOf(WordPreviewError)
    expect(failure.code).toBe('network')
    expect(failure.message).not.toContain('private')
  })
})
