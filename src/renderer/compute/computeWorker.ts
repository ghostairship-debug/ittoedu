import type { ComputeWorkerInput, ComputeWorkerReply } from '../../main/workbench/compute/ComputeBackend'

type RuntimeFS = {
  filesystems: { WORKERFS: unknown }; mkdirTree(path: string): void; mount(type: unknown, options: unknown, mountpoint: string): void
  writeFile(path: string, bytes: Uint8Array): void; readFile(path: string): Uint8Array; chdir(path: string): void; symlink(target: string, path: string): void
  readdir(path: string): string[]; lstat(path: string): { mode: number }; isDir(mode: number): boolean; isFile(mode: number): boolean; isLink(mode: number): boolean
}
type Runtime = { FS: RuntimeFS; runPythonAsync(code: string): Promise<unknown> }
type Manifest = { schemaVersion: number; pyodide: { entry: string }; packages: string[]; font: { file: string; family: string } }
const worker = globalThis as unknown as { onmessage: ((event: MessageEvent<ComputeWorkerInput>) => void) | null; postMessage(value: ComputeWorkerReply): void }

worker.onmessage = async ({ data: input }) => {
  worker.onmessage = null
  const stdout: string[] = [], stderr: string[] = []
  const reply: ComputeWorkerReply = { executionId: input.executionId, exitCode: 1, stdout: '', stderr: '', truncated: false, cancelled: false, outputs: [], outputDiagnostics: [] }
  try {
    const base = new URL(input.runtimeBaseURL)
    const manifest = await (await fetch(new URL('manifest.json', base))).json() as Manifest
    if (manifest.schemaVersion !== 1) throw new Error('内置计算资源清单无法识别')
    const entry = new URL(manifest.pyodide.entry, base), indexURL = new URL('./', entry).href
    const { loadPyodide } = await import(/* @vite-ignore */ entry.href) as { loadPyodide(options: Record<string, unknown>): Promise<Runtime> }
    const runtime = await loadPyodide({ indexURL, lockFileURL: new URL('pyodide-lock.json', indexURL).href,
      packageBaseUrl: indexURL, packages: manifest.packages, stdin: () => null,
      stdout: (line: string) => stdout.push(line), stderr: (line: string) => stderr.push(line),
      env: { GUOLING_INPUT_DIR: '/job/input', GUOLING_OUTPUT_DIR: '/job/output', MPLBACKEND: 'Agg', MPLCONFIGDIR: '/tmp/matplotlib' } })
    const fs = runtime.FS
    fs.mkdirTree('/job/input'); fs.mkdirTree('/job/output'); fs.mkdirTree('/job/fonts')
    // WORKERFS exposes immutable input Blobs and has no host filesystem mount.
    fs.mount(fs.filesystems.WORKERFS, { blobs: [...input.inputs, { name: '__main__.py', bytes: new TextEncoder().encode(input.code) }]
      .map(file => ({ name: file.name, data: new Blob([Uint8Array.from(file.bytes).buffer]) })) }, '/job/input')
    fs.symlink('/job/output', '/job/work'); fs.chdir('/job/output')
    const fontPath = `/job/fonts/${manifest.font.file.split('/').pop()}`
    fs.writeFile(fontPath, new Uint8Array(await (await fetch(new URL(manifest.font.file, base))).arrayBuffer()))
    await runtime.runPythonAsync(`import os, sys\nsys.argv = ['/job/input/__main__.py']\nsys.path.insert(0, '/job/input')\n__file__ = '/job/input/__main__.py'\nimport matplotlib\nmatplotlib.use('Agg')\nfrom matplotlib import font_manager\nfont_manager.fontManager.addfont(${JSON.stringify(fontPath)})\nmatplotlib.rcParams['font.family'] = [${JSON.stringify(manifest.font.family)}]\nmatplotlib.rcParams['axes.unicode_minus'] = False`)
    // Keep Python's async evaluation (including top-level await) and its normal
    // script exit semantics; SystemExit(0) is successful work, not a JS failure.
    reply.exitCode = Number(await runtime.runPythonAsync(`
async def _guoling_run_script(source):
    from pyodide.code import eval_code_async
    import sys
    try:
        await eval_code_async(source, globals={'__name__': '__main__', '__file__': '/job/input/__main__.py'}, filename='/job/input/__main__.py')
    except SystemExit as error:
        if error.code is None:
            return 0
        if isinstance(error.code, int):
            return error.code
        print(error.code, file=sys.stderr)
        return 1
    return 0
await _guoling_run_script(${JSON.stringify(input.code)})`))
    const outputs: { name: string; bytes: Uint8Array }[] = [], diagnostics: { name: string; code: string; message: string }[] = []
    const visit = (directory: string, prefix: string) => {
      for (const name of fs.readdir(directory)) {
        if (name === '.' || name === '..') continue
        const filename = `${directory}/${name}`, relative = prefix ? `${prefix}/${name}` : name
        const stat = fs.lstat(filename)
        if (fs.isLink(stat.mode)) diagnostics.push({ name: relative, code: 'output-symlink', message: '计算输出包含链接，未登记为成果' })
        else if (fs.isDir(stat.mode)) visit(filename, relative)
        else if (fs.isFile(stat.mode)) outputs.push({ name: relative, bytes: Uint8Array.from(fs.readFile(filename)) })
        else diagnostics.push({ name: relative, code: 'output-invalid', message: '计算输出不是普通文件' })
      }
    }
    if (reply.exitCode === 0) visit('/job/output', '')
    reply.outputs = outputs; reply.outputDiagnostics = diagnostics
  } catch (error) { reply.exitCode = 1; stderr.push(error instanceof Error ? error.message : String(error)) }
  reply.stdout = stdout.join('\n'); reply.stderr = stderr.join('\n')
  worker.postMessage(reply)
}
