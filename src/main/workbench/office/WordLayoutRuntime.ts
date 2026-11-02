import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { runPythonProcess } from '../compute/nativePythonProcess'
import type { WordPreviewConverter } from './WordPreviewService'
import { WordPreviewError, throwWordPreviewError } from './WordPreviewError'

// Published by TDF and PortableApps. Standard includes Simplified/Traditional Chinese.
// https://bn.libreoffice.org/download/portable-versions/
// https://portableapps.com/apps/office/libreoffice_portable
export const WORD_LAYOUT_RELEASE = Object.freeze({
  version: '26.2.4',
  url: 'https://download.documentfoundation.org/libreoffice/portable/26.2.4/LibreOfficePortable_26.2.4_MultilingualStandard.paf.exe',
  sha256: '4bde93374aef4409243505b20d16561a4628ac7591457dd01fc6e1ccf571ba65',
})

export interface WordLayoutRuntimeInfo { executable: string; version: string }
export interface WordLayoutRuntimeOptions {
  /** Application-owned user-data directory, independent of the project and original documents. */
  directory: string
  /** Shipped 7-Zip executable with NSIS support; never a development node_modules path in a release. */
  extractorPath?: string
  /** A host may provide selected local candidates. Empty explicitly requests a managed runtime. */
  candidates?: readonly string[]
  /** The desktop host supplies Electron net.fetch, retaining its normal network/proxy support. */
  download?: (url: string, signal: AbortSignal) => Promise<Response>
  run?: typeof runPythonProcess
}

/** A local Word pagination dependency, prepared once without changing system installations. */
export class WordLayoutRuntime {
  private ready?: WordLayoutRuntimeInfo
  private tail: Promise<unknown> = Promise.resolve()
  private readonly run: typeof runPythonProcess
  constructor(private readonly options: WordLayoutRuntimeOptions) { this.run = options.run ?? runPythonProcess }

  ensure(signal: AbortSignal, log: (line: string) => void = () => {}): Promise<WordLayoutRuntimeInfo> {
    let entered = false
    const work = this.tail.catch(() => undefined).then(async () => {
      signal.throwIfAborted(); entered = true
      const current = this.ready && await this.inspect(this.ready.executable, signal)
      if (current) return this.ready = current
      this.ready = undefined
      return this.ready = await this.prepare(signal, log)
    })
    this.tail = work.catch(() => undefined)
    return new Promise<WordLayoutRuntimeInfo>((resolve, reject) => {
      const abort = () => { if (!entered) reject(signal.reason) }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
  }

  private candidates(): readonly string[] {
    if (this.options.candidates) return this.options.candidates
    if (process.platform === 'win32') {
      const directories = [...new Set([process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432]
        .filter((value): value is string => Boolean(value)))]
      return [...directories.map(directory => path.join(directory, 'LibreOffice', 'program', 'soffice.com')), 'soffice.com']
    }
    return process.platform === 'darwin'
      ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice', 'soffice'] : ['libreoffice', 'soffice']
  }

  private async inspect(executable: string, signal: AbortSignal): Promise<WordLayoutRuntimeInfo | undefined> {
    try {
      // A version probe is bounded; document conversion itself remains cancellable
      // without an arbitrary size or duration ceiling.
      const result = await this.run(executable, ['--headless', '--version'], { signal, timeoutMs: 10_000 })
      const version = /LibreOffice\s+(\d+(?:\.\d+)+)/i.exec(result.stdout)?.[1]
      return result.code === 0 && version ? { executable, version } : undefined
    } catch { signal.throwIfAborted(); return undefined }
  }

  private async managedExecutable(directory: string): Promise<string | undefined> {
    // Keep the publisher's complete tree (including licenses). Do not run the PAF
    // installer, alter its platform checks, or register file associations.
    for (const root of [directory, path.join(directory, 'LibreOfficePortable'), path.join(directory, '$INSTDIR')]) {
      const executable = path.join(root, 'App', 'libreoffice', 'program', 'soffice.com')
      if (await fs.stat(executable).then(value => value.isFile(), () => false)) return executable
    }
    return undefined
  }

  private async downloadArchive(filename: string, signal: AbortSignal): Promise<void> {
    let response: Response
    try { response = await (this.options.download ?? ((url, abort) => fetch(url, { signal: abort })))(WORD_LAYOUT_RELEASE.url, signal) }
    catch { throwWordPreviewError(signal, 'network') }
    signal.throwIfAborted()
    if (!response.ok || !response.body) throw new WordPreviewError('network')
    const reader = response.body.getReader(), hash = createHash('sha256')
    const file = await fs.open(filename, 'wx')
    const abort = () => { void reader.cancel(signal.reason).catch(() => {}) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      signal.throwIfAborted()
      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>
        try { chunk = await reader.read() } catch { throwWordPreviewError(signal, 'network') }
        const { value, done } = chunk
        signal.throwIfAborted()
        if (done) break
        hash.update(value)
        let offset = 0
        while (offset < value.length) {
          const { bytesWritten } = await file.write(value, offset, value.length - offset)
          if (!bytesWritten) throw new Error('Word 排版环境下载无法写入用户数据目录')
          offset += bytesWritten
        }
      }
      if (hash.digest('hex') !== WORD_LAYOUT_RELEASE.sha256) throw new WordPreviewError('integrity')
    } finally {
      signal.removeEventListener('abort', abort)
      await reader.cancel().catch(() => {})
      reader.releaseLock()
      await file.close()
    }
  }

  private async prepare(signal: AbortSignal, log: (line: string) => void): Promise<WordLayoutRuntimeInfo> {
    for (const executable of this.candidates()) {
      const installed = await this.inspect(executable, signal)
      if (installed) return installed
    }
    const destination = path.join(this.options.directory, `libreoffice-${WORD_LAYOUT_RELEASE.version}`)
    const managed = await this.managedExecutable(destination)
    if (managed) {
      const installed = await this.inspect(managed, signal)
      if (installed) return installed
    }
    if (process.platform !== 'win32' || process.arch !== 'x64')
      throw new WordPreviewError('component')
    const extractorPath = this.options.extractorPath
    const extractorAvailable = extractorPath && await fs.stat(extractorPath).then(stat => stat.isFile(), () => false)
    signal.throwIfAborted()
    if (!extractorPath || !extractorAvailable) throw new WordPreviewError('component')
    await fs.mkdir(this.options.directory, { recursive: true })
    const scratch = await fs.mkdtemp(path.join(this.options.directory, 'prepare-word-'))
    try {
      const archive = path.join(scratch, 'libreoffice.paf.exe'), extracted = path.join(scratch, 'runtime')
      log('首次打开 Word 正在准备本地排版环境；完成后可离线预览。')
      await this.downloadArchive(archive, signal)
      signal.throwIfAborted()
      await fs.mkdir(extracted)
      log('正在展开 Word 排版环境。')
      let result: Awaited<ReturnType<typeof runPythonProcess>>
      try { result = await this.run(extractorPath, ['x', archive, `-o${extracted}`, '-y'], { signal }) }
      catch { throwWordPreviewError(signal, 'extraction') }
      signal.throwIfAborted()
      if (result.code !== 0) throw new WordPreviewError('extraction')
      const staged = await this.managedExecutable(extracted)
      const inspected = staged && await this.inspect(staged, signal)
      if (!staged || !inspected) throw new WordPreviewError('extraction')
      await fs.writeFile(path.join(extracted, 'guoling-word-runtime.json'), JSON.stringify(WORD_LAYOUT_RELEASE, null, 2))
      signal.throwIfAborted()
      const old = `${destination}.previous-${randomUUID()}`
      const replaced = await fs.rename(destination, old).then(() => true, error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
      })
      try { await fs.rename(extracted, destination) }
      catch (error) { if (replaced) await fs.rename(old, destination); throw error }
      if (replaced) await fs.rm(old, { recursive: true, force: true })
      log('Word 本地排版环境已就绪。')
      return { executable: path.join(destination, path.relative(extracted, staged)), version: inspected.version }
    } finally { await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  }
}

/** Disable macros and linked-content refresh in this preview's fresh profile only.
 * Writer's Update/Link maps directly to sw/inc/linkenum.hxx (NEVER = 0).
 */
const PREVIEW_PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
  <item oor:path="/org.openoffice.Office.Common/Security/Scripting">
    <prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop>
    <prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>
  </item>
  <item oor:path="/org.openoffice.Office.Writer/Content/Update">
    <prop oor:name="Link" oor:op="fuse"><value>0</value></prop>
  </item>
</oor:items>`

export function createWordPreviewConverter(runtime: WordLayoutRuntime, options: {
  log?(line: string): void
  run?: typeof runPythonProcess
} = {}): WordPreviewConverter {
  return async input => {
    const signal = input.signal ?? new AbortController().signal
    const info = await runtime.ensure(signal, options.log)
    const userProfile = path.join(input.profileDirectory, 'user')
    await fs.mkdir(userProfile, { recursive: true })
    await fs.writeFile(path.join(userProfile, 'registrymodifications.xcu'), PREVIEW_PROFILE)
    let result: Awaited<ReturnType<typeof runPythonProcess>>
    try { result = await (options.run ?? runPythonProcess)(info.executable, [
      `-env:UserInstallation=${pathToFileURL(input.profileDirectory).href}`,
      '--headless', '--nologo', '--nodefault', '--norestore',
      '--convert-to', 'pdf:writer_pdf_Export', '--outdir', input.outputDirectory, input.sourcePath,
    ], { cwd: input.outputDirectory, signal }) }
    catch { throwWordPreviewError(signal, 'conversion') }
    signal.throwIfAborted()
    if (result.code !== 0) throw new WordPreviewError('conversion')
    return { engine: { name: 'LibreOffice', version: info.version } }
  }
}
