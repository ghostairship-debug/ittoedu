import { spawn } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, rmdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { externalMcpPortSchema } from '../../../shared/workbench/external'
import { executionPermissionModeSchema, type ExecutionPermissionMode } from '../../../shared/workbench/executionPermission'
import { waitForMcpConnection, type McpConnectionReady } from '../../../shared/workbench/mcpConnection'

export interface InstalledMcpBootstrapOptions {
  executable: string
  workspace: string
  profile?: string
  port?: number
  permission?: ExecutionPermissionMode
  timeoutMs?: number
}

/** One-use connection handoff to the existing product owner; no launcher-owned daemon. */
export async function bootstrapInstalledMcp(options: InstalledMcpBootstrapOptions): Promise<McpConnectionReady> {
  const executable = await realpath(options.executable)
  if (!(await stat(executable)).isFile()) throw new Error('果铃产品入口不是可执行文件')
  const workspace = await realpath(options.workspace)
  if (!(await stat(workspace)).isDirectory()) throw new Error('作品工作空间必须是目录')
  const args = ['--headless-mcp', `--workspace=${workspace}`]
  if (options.profile) args.push(`--user-data-dir=${path.resolve(options.profile)}`)
  if (options.port !== undefined) args.push(`--port=${externalMcpPortSchema.parse(options.port)}`)
  if (options.permission !== undefined) args.push(`--permission=${executionPermissionModeSchema.parse(options.permission)}`)
  const directory = await mkdtemp(path.join(os.tmpdir(), 'guoling-mcp-connect-'))
  const readyFile = path.join(directory, 'ready.json')
  args.push(`--mcp-ready-file=${readyFile}`)
  const environment: NodeJS.ProcessEnv = { ...process.env, VITE_DEV_SERVER_URL: '' }
  delete environment.ELECTRON_RUN_AS_NODE
  // No IPC channel: a successful bootstrap returns and its parent may exit.
  // The resident Main, not this one-use helper, owns the product lifetime.
  const child = spawn(executable, args, { cwd: workspace, env: environment, detached: true, stdio: 'ignore' })
  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined
  let launchError: Error | undefined
  child.once('error', error => { launchError = error; exited = { code: 1, signal: null } })
  child.once('exit', (code, signal) => { exited = { code, signal } })
  try {
    return await waitForMcpConnection({
      read: async () => {
        if (launchError) throw new Error(`果铃未能启动：${launchError.message}`)
        try { return JSON.parse(await readFile(readyFile, 'utf8')) as unknown }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
      },
      exit: () => exited,
      timeoutMs: options.timeoutMs,
    })
  } finally {
    // A timeout is not evidence that the owner stopped. Leave it available for
    // a subsequent attach; do not kill a process that may own user documents.
    child.unref()
    await rm(readyFile, { force: true })
    await rm(path.join(directory, 'ready.tmp'), { force: true })
    await rmdir(directory)
  }
}

/** Product CLI uses the task location; no teacher-supplied bearer, port or ID. */
export async function runProductMcpBootstrap(argv: readonly string[], input: { executable: string; cwd: string }): Promise<McpConnectionReady> {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!
    if (argument === '--mcp-connect') continue
    if (!argument.startsWith('--')) continue // executable path in packaged argv
    const name = argument.split('=', 1)[0]!
    if (!['--workspace', '--task-path', '--port', '--permission', '--user-data-dir'].includes(name)) throw new Error(`连接入口不支持参数 ${name}`)
    const value = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`${name} 需要参数`)
    if (values.has(name)) throw new Error(`${name} 只能指定一次`)
    values.set(name, value)
  }
  const taskPath = values.get('--task-path')
  let workspace = path.resolve(input.cwd, values.get('--workspace') ?? '.')
  if (taskPath) {
    if (values.has('--workspace')) throw new Error('请指定作品位置或工作空间中的一个')
    const task = path.resolve(input.cwd, taskPath)
    let isDirectory = false
    try { isDirectory = (await stat(task)).isDirectory() }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    workspace = isDirectory ? task : path.dirname(task)
  }
  const port = values.get('--port')
  if (port !== undefined && !/^\d+$/.test(port)) throw new Error('--port 必须是整数')
  return bootstrapInstalledMcp({ executable: input.executable, workspace,
    ...(values.has('--user-data-dir') ? { profile: path.resolve(input.cwd, values.get('--user-data-dir')!) } : {}),
    ...(port !== undefined ? { port: externalMcpPortSchema.parse(Number(port)) } : {}),
    ...(values.has('--permission') ? { permission: executionPermissionModeSchema.parse(values.get('--permission')) } : {}),
  })
}
