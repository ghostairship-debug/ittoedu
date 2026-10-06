import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareElectronLaunchEnvironment } from './electronLaunchEnvironment'
import { resolveEngineeringProfileLaunch } from './engineeringProfileLaunch'
import { mcpServerElectronArguments, waitForMcpConnection } from './mcpServerLaunch'

const usage = 'npm --silent run mcp:server -- --workspace "<绝对目录>" [--port 45123] [--permission workspace] [--user-data-dir="<独立档目录>"] --ready-json'

async function main(): Promise<number> {
  if (process.argv.includes('--help')) { process.stderr.write(`${usage}\n`); return 0 }
  prepareElectronLaunchEnvironment()
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const launch = resolveEngineeringProfileLaunch(mcpServerElectronArguments(process.argv.slice(2)))
  const missing = ['dist-electron/main/index.js', 'dist-renderer/observation.html', 'dist-renderer/document-export.html']
    .filter(filename => !existsSync(path.join(root, filename)))
  if (missing.length) throw new Error(`缺少已有构建制品：${missing.join('、')}。请先准备对应 Main/Renderer 构建；启动器不会重新构建产品。`)
  const electronBinary = createRequire(import.meta.url)('electron') as unknown as string
  const handoffDirectory = await mkdtemp(path.join(os.tmpdir(), 'guoling-mcp-connect-'))
  const readyFile = path.join(handoffDirectory, 'ready.json')
  const cleanupHandoff = async () => {
    const relative = path.relative(os.tmpdir(), handoffDirectory)
    if (relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(handoffDirectory).startsWith('guoling-mcp-connect-')) {
      throw new Error('连接交接目录超出本次临时目录')
    }
    await rm(handoffDirectory, { recursive: true, force: true })
  }
  const child = spawn(electronBinary, [...launch.args, `--mcp-ready-file=${readyFile}`], {
    cwd: root, env: { ...process.env, VITE_DEV_SERVER_URL: '' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  child.stdout!.pipe(process.stderr)
  child.stderr!.pipe(process.stderr)
  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined
  let stopRequested = false
  const exit = new Promise<number>(resolve => {
    child.once('exit', (code, signal) => { exited = { code, signal }; resolve(signal ? 1 : code ?? 1) })
    child.once('error', error => { process.stderr.write(`启动 Electron 失败：${error.message}\n`); exited = { code: 1, signal: null }; resolve(1) })
  })
  const requestStop = () => {
    if (stopRequested || exited) return
    stopRequested = true
    if (child.connected) child.send({ type: 'mcp-stop' }, error => {
      if (error) process.stderr.write(`MCP 正常停止请求未送达：${error.message}\n`)
    })
  }
  process.on('SIGINT', requestStop)
  process.on('SIGTERM', requestStop)
  const onParentMessage = (message: unknown) => {
    if (message && typeof message === 'object' && 'type' in message && message.type === 'mcp-stop') requestStop()
  }
  process.on('message', onParentMessage)
  process.on('disconnect', requestStop)
  try {
    const connection = await waitForMcpConnection({
      read: async () => {
        try { return JSON.parse(await readFile(readyFile, 'utf8')) as unknown }
        catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined; throw error }
      },
      exit: () => exited,
    })
    await cleanupHandoff()
    process.stdout.write(`${JSON.stringify(connection)}\n`)
    if (connection.workspaceMismatch) process.stderr.write(`已附着既有宿主；请求目录 ${connection.requestedWorkspace}，实际授权目录 ${connection.workspace}。\n`)
    // An attached launch owns only the short-lived second process. It never stops the resident owner.
    const code = await exit
    if (connection.ownership === 'owned' && stopRequested) {
      process.stderr.write(`${JSON.stringify({ stage: 'owned-host.stop', status: code === 0 ? 'completed' : 'failed', pid: connection.pid, exitCode: code })}\n`)
    }
    return code
  } catch (error) {
    requestStop()
    await exit
    throw error
  } finally {
    process.off('SIGINT', requestStop)
    process.off('SIGTERM', requestStop)
    process.off('message', onParentMessage)
    process.off('disconnect', requestStop)
    await cleanupHandoff()
  }
}

main().then(code => { process.exitCode = code }, error => {
  process.stderr.write(`MCP 启动失败：${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
