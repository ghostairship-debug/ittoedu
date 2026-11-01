import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { unzipSync } from 'fflate'
import { pythonEnvironment, runPythonProcess } from './nativePythonProcess'
import { systemProxyRoute } from '../network/systemProxy'

const UV_VERSION = '0.13.6'
const probe = `import sys,json,importlib,importlib.util
missing=[]
for name in ['numpy','pandas','matplotlib']:
    try:
        importlib.import_module(name)
    except ImportError:
        missing.append(name)
print(json.dumps({'executable':sys.executable,'version':list(sys.version_info[:2]),'missing':missing}))`
interface PythonInfo { executable: string; version: number[]; missing: string[] }
export interface NativePythonRuntimeOptions {
  directory: string
  /** Explicit candidates are also useful for hosts with a selected interpreter. Empty means provision. */
  candidates?: readonly { executable: string; args?: readonly string[] }[]
  download?: (url: string, signal: AbortSignal) => Promise<Response>
}

/** Provision only on first compute. Reuse and supplement the user's actual environment. */
export class NativePythonRuntime {
  private ready?: string
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly options: NativePythonRuntimeOptions) {}
  ensure(signal: AbortSignal, log: (line: string) => void): Promise<string> {
    let entered = false
    const work = this.tail.catch(() => undefined).then(async () => {
      signal.throwIfAborted()
      entered = true
      if (this.ready) return this.ready
      return this.ready = await this.prepare(signal, log)
    })
    this.tail = work.catch(() => undefined)
    return new Promise<string>((resolve, reject) => {
      // Queued callers can stop immediately; the current preparer must await
      // its download/process cleanup before reporting a confirmed cancellation.
      const abort = () => { if (!entered) reject(signal.reason) }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
  }
  private async environment(url: string): Promise<NodeJS.ProcessEnv> {
    const proxy = await systemProxyRoute(url)
    const inherited = pythonEnvironment()
    const address = proxy.kind === 'direct' ? undefined : `${proxy.kind === 'http' ? 'http' : 'socks5'}://${proxy.host.includes(':') ? `[${proxy.host}]` : proxy.host}:${proxy.port}`
    return { ...inherited, ...(address && !inherited.HTTPS_PROXY && !inherited.https_proxy ? { HTTPS_PROXY: address, HTTP_PROXY: address } : {}),
      UV_PYTHON_INSTALL_DIR: path.join(this.options.directory, 'interpreters'),
      UV_PYTHON_BIN_DIR: path.join(this.options.directory, 'bin'),
      UV_CACHE_DIR: path.join(this.options.directory, 'cache'), UV_NO_PROGRESS: '1', UV_PYTHON_DOWNLOADS: 'automatic' }
  }
  private async inspect(executable: string, args: readonly string[], signal: AbortSignal): Promise<PythonInfo | undefined> {
    try {
      const result = await runPythonProcess(executable, [...args, '-E', '-X', 'utf8', '-c', probe], { signal, timeoutMs: 10_000 })
      if (result.code !== 0) return undefined
      const info = JSON.parse(result.stdout.trim()) as PythonInfo
      return path.isAbsolute(info.executable) && info.version[0] === 3 && info.version[1] >= 10 ? info : undefined
    } catch (error) { signal.throwIfAborted(); return undefined }
  }
  private async candidates() {
    if (this.options.candidates) return this.options.candidates
    const result: { executable: string; args?: readonly string[] }[] = []
    for (const root of [process.env.VIRTUAL_ENV, process.env.CONDA_PREFIX])
      if (root) result.push({ executable: path.join(root, process.platform === 'win32' ? 'python.exe' : 'bin/python') })
    result.push({ executable: 'python' }, { executable: 'python3' })
    if (process.platform === 'win32') {
      result.push({ executable: 'py', args: ['-3'] })
      const directory = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python')
      for (const item of await fs.readdir(directory, { withFileTypes: true }).catch(() => []))
        if (item.isDirectory() && /^Python\d+$/.test(item.name)) result.push({ executable: path.join(directory, item.name, 'python.exe') })
    }
    return result
  }
  private async prepare(signal: AbortSignal, log: (line: string) => void): Promise<string> {
    const receipt = path.join(this.options.directory, 'python.json')
    const managed = await fs.readFile(receipt, 'utf8').then(text => (JSON.parse(text) as { executable: string }).executable, () => undefined)
    let existing: PythonInfo | undefined
    // Prefer an already usable user environment, then our previously prepared environment.
    for (const candidate of [...await this.candidates(), ...(managed ? [{ executable: managed }] : [])]) {
      const info = await this.inspect(candidate.executable, candidate.args ?? [], signal)
      if (!info) continue
      if (!info.missing.length) { log(`使用原生 Python：${info.executable}`); return info.executable }
      existing ??= info
    }
    log(existing ? `正在向已有 Python 补装缺少的计算库：${existing.executable}` : '未发现可用 Python，正在按需下载原生 Python。')
    const uv = await this.prepareUv(signal, log)
    const run = async (args: string[]) => {
      const result = await runPythonProcess(uv, args, { signal,
        env: await this.environment(args[0] === 'python' ? 'https://github.com' : 'https://pypi.org'), log })
      if (result.code !== 0) throw new Error(`Python 环境准备失败：${result.stderr || result.stdout}`)
      return result.stdout.trim()
    }
    let interpreter = existing?.executable
    if (!interpreter) {
      await run(['python', 'install', '3.13', '--no-config'])
      interpreter = await run(['python', 'find', '--managed-python', '3.13', '--no-config'])
    }
    // Preserve installed versions while supplementing missing libraries. An actual
    // conflict is reported instead of silently upgrading/downgrading the environment.
    await fs.mkdir(this.options.directory, { recursive: true })
    const constraints = path.join(this.options.directory, `constraints-${randomUUID()}.txt`)
    const installed = await runPythonProcess(interpreter, ['-E', '-X', 'utf8', '-c',
      "from importlib.metadata import distributions; print('\\n'.join(d.metadata['Name']+'=='+d.version for d in distributions() if d.metadata['Name']))"], { signal })
    if (installed.code !== 0) throw new Error(`无法读取已有 Python 依赖：${installed.stderr}`)
    await fs.writeFile(constraints, installed.stdout)
    try {
      const interpreterRoot = path.join(this.options.directory, 'interpreters')
      const [realInterpreter, realRoot] = await Promise.all([fs.realpath(interpreter).catch(() => interpreter), fs.realpath(interpreterRoot).catch(() => interpreterRoot)])
      const relative = path.relative(realRoot, realInterpreter)
      const owned = relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
      await run(['pip', 'install', '--python', interpreter, '--no-config', '--only-binary', ':all:', '--constraint', constraints,
        ...(owned ? ['--break-system-packages'] : []),
        ...(existing?.missing ?? ['numpy', 'pandas', 'matplotlib'])])
    } finally { await fs.rm(constraints, { force: true }) }
    const info = await this.inspect(interpreter, [], signal)
    if (!info || info.missing.length) throw new Error('Python 计算库未准备完整，请检查环境或重试计算。')
    await fs.writeFile(receipt, JSON.stringify({ executable: info.executable }))
    log(`使用原生 Python：${info.executable}`)
    return info.executable
  }
  private async prepareUv(signal: AbortSignal, log: (line: string) => void): Promise<string> {
    if (process.platform !== 'win32' || !['x64', 'arm64'].includes(process.arch))
      throw new Error('当前自动安装支持 Windows x64/ARM64；其他平台请先安装 Python 和 NumPy、pandas、Matplotlib。')
    const executable = path.join(this.options.directory, `uv-${UV_VERSION}`, 'uv.exe')
    if (await fs.stat(executable).then(s => s.isFile(), () => false)) return executable
    const platform = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
    const base = `https://releases.astral.sh/github/uv/releases/download/${UV_VERSION}/uv-${platform}-pc-windows-msvc.zip`
    const download = this.options.download ?? ((url, signal) => fetch(url, { signal }))
    const read = async (url: string) => {
      const response = await download(url, signal)
      if (!response.ok) throw new Error(`Python 安装工具下载失败：HTTP ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    }
    log('正在下载 Python 环境安装工具 uv（仅保存到果铃用户数据目录）。')
    const archive = await read(base), checksum = new TextDecoder().decode(await read(`${base}.sha256`)).trim().split(/\s+/)[0]
    // Downloaded executable identity, not a general correctness gate.
    if (!/^[a-f0-9]{64}$/i.test(checksum) || createHash('sha256').update(archive).digest('hex') !== checksum.toLowerCase())
      throw new Error('Python 安装工具下载不完整，请重试。')
    const contents = unzipSync(archive, { filter: entry => entry.name === 'uv.exe' })['uv.exe']
    if (!contents) throw new Error('Python 安装工具归档缺少 uv.exe')
    signal.throwIfAborted()
    await fs.mkdir(path.dirname(executable), { recursive: true })
    const temporary = `${executable}.${randomUUID()}.tmp`
    try { await fs.writeFile(temporary, contents); signal.throwIfAborted(); await fs.rename(temporary, executable) }
    finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
    return executable
  }
}
