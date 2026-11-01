import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ComputeBackend, ComputeBackendRequest, ComputeProcess, ComputeProcessResult } from './ComputeBackend'
import { NativePythonRuntime, type NativePythonRuntimeOptions } from './NativePythonRuntime'
import { pythonEnvironment, runPythonProcess } from './nativePythonProcess'

/** Native execution has current-user OS access; this is not the former browser sandbox. */
export class NativePythonComputeBackend implements ComputeBackend {
  readonly kind = 'native-python' as const
  private readonly runtime: NativePythonRuntime
  private readonly active = new Map<string, ComputeProcess>()
  private disposed = false
  constructor(private readonly options: NativePythonRuntimeOptions & { fontFile?: string }) { this.runtime = new NativePythonRuntime(options) }
  locations(directory: string) { return { input: path.join(directory, 'input'), work: path.join(directory, 'output'), output: path.join(directory, 'output') } }
  async availability() { return this.disposed ? { available: false, reason: 'Python 计算服务已关闭' } : { available: true } }
  async start(request: ComputeBackendRequest): Promise<ComputeProcess> {
    if (this.disposed) throw new Error('Python 计算服务已关闭')
    if (request.code === undefined || !['python', 'python3'].includes(request.program)) throw new Error('计算入口需要 Python 源码')
    if (this.active.has(request.executionId)) throw new Error('计算作业已在运行')
    const controller = new AbortController(), preparation: string[] = []
    let stopConfirmed = true
    const done = (async (): Promise<ComputeProcessResult> => {
      try {
        const executable = await this.runtime.ensure(controller.signal, line => request.onLog ? request.onLog(line) : preparation.push(line))
        controller.signal.throwIfAborted()
        const input = path.join(request.directory, 'input'), output = path.join(request.directory, 'output')
        const script = path.join(input, '__main__.py')
        const driver = path.join(request.directory, 'native-runner.py')
        const setup = `import os,sys,asyncio,ast\nsys.argv=[${JSON.stringify(script)}]\nsys.path.insert(0,${JSON.stringify(input)})\n`
        const font = this.options.fontFile && await fs.stat(this.options.fontFile).then(s => s.isFile(), () => false)
          ? `from matplotlib import font_manager\nfont_manager.fontManager.addfont(${JSON.stringify(this.options.fontFile)})\nmatplotlib.rcParams['font.family']=['Noto Sans SC']\n` : ''
        await fs.writeFile(driver, `${setup}import matplotlib\nmatplotlib.use('Agg')\nfrom matplotlib import font_manager\navailable={f.name for f in font_manager.fontManager.ttflist}\nchinese=[n for n in ['Microsoft YaHei','SimHei','Noto Sans CJK SC','Noto Sans SC','PingFang SC'] if n in available]\nif chinese:\n    matplotlib.rcParams['font.family']=chinese+['DejaVu Sans']\n${font}matplotlib.rcParams['axes.unicode_minus']=False\nwith open(${JSON.stringify(script)},encoding='utf-8') as f:\n    source=f.read()\ncode=compile(source,${JSON.stringify(script)},'exec',flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)\nresult=eval(code,{'__name__':'__main__','__file__':${JSON.stringify(script)}})\nif result is not None:\n    asyncio.run(result)\n`)
        controller.signal.throwIfAborted()
        const result = await runPythonProcess(executable, ['-E', '-X', 'utf8', '-u', driver], {
          cwd: output, signal: controller.signal,
          onStop: confirmed => { stopConfirmed = confirmed },
          env: pythonEnvironment({ GUOLING_INPUT_DIR: input, GUOLING_OUTPUT_DIR: output,
            MPLBACKEND: 'Agg', MPLCONFIGDIR: path.join(request.directory, 'matplotlib') }),
        })
        return { exitCode: result.code, stdout: result.stdout, stderr: [...preparation, result.stderr].filter(Boolean).join('\n'),
          truncated: false, cancelled: false }
      } catch (error) {
        return { exitCode: controller.signal.aborted ? null : 1, stdout: '',
          stderr: [...preparation, error instanceof Error ? error.message : String(error)].join('\n'), truncated: false, cancelled: controller.signal.aborted && stopConfirmed }
      } finally { this.active.delete(request.executionId) }
    })()
    const process: ComputeProcess = { done, cancel: async () => { controller.abort(); await done; return stopConfirmed } }
    this.active.set(request.executionId, process)
    return process
  }
  async inspectExecution(id: string): Promise<'running' | 'unknown'> { return this.active.has(id) ? 'running' : 'unknown' }
  async stopExecution(id: string): Promise<boolean> { return await this.active.get(id)?.cancel() ?? false }
  dispose(): void { this.disposed = true; for (const process of this.active.values()) void process.cancel() }
}
