import path from 'node:path'
import { externalMcpPortSchema } from '../src/shared/workbench/external'
import { executionPermissionModeSchema, type ExecutionPermissionMode } from '../src/shared/workbench/executionPermission'

/** Connection facts returned by the resident owner, including when this launch attached. */
export interface McpConnectionReady {
  status: 'ready'
  endpoint: string
  token: string
  workspace: string
  workspaceId: string
  permission: ExecutionPermissionMode
  pid: number
  profile: string
  mode: 'headless' | 'gui'
  ownership: 'owned' | 'attached'
  requestedWorkspace: string
  workspaceMismatch: boolean
}

export function mcpServerElectronArguments(args: readonly string[]): string[] {
  const forwarded: string[] = []
  let workspace: string | undefined
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!
    if (argument === '--ready-json' || argument === '--headless-mcp') continue
    if (argument === '--mcp-ready-file' || argument.startsWith('--mcp-ready-file=')) {
      throw new Error('--mcp-ready-file 由启动器维护，请使用 stdout 的连接 JSON')
    }
    const name = argument.split('=', 1)[0]!
    if (name !== '--workspace' && name !== '--port' && name !== '--permission') {
      forwarded.push(argument)
      continue
    }
    const value = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : args[++index]
    if (!value || value.startsWith('--')) throw new Error(`${name} 需要参数`)
    if (name === '--workspace') {
      if (workspace) throw new Error('--workspace 只能指定一次')
      if (!path.isAbsolute(value)) throw new Error('--workspace 必须是绝对目录')
      workspace = path.normalize(value)
      forwarded.push(`--workspace=${workspace}`)
    } else if (name === '--port') {
      if (!/^\d+$/.test(value)) throw new Error('--port 必须是 1024–65535 的整数')
      forwarded.push(`--port=${externalMcpPortSchema.parse(Number(value))}`)
    } else {
      forwarded.push(`--permission=${executionPermissionModeSchema.parse(value)}`)
    }
  }
  if (!workspace) throw new Error('请显式指定 --workspace "<绝对目录>"')
  return ['.', '--headless-mcp', ...forwarded, '--ready-json']
}

/** A launcher exit is not a ready receipt: a second-instance launch exits before its owner replies. */
export async function waitForMcpConnection(input: {
  read(): Promise<unknown | undefined>
  exit(): { code: number | null; signal: NodeJS.Signals | null } | undefined
  timeoutMs?: number
  pause?(milliseconds: number): Promise<void>
  now?(): number
}): Promise<McpConnectionReady> {
  const now = input.now ?? Date.now
  const pause = input.pause ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  const started = now()
  while (true) {
    const reply = await input.read()
    if (reply !== undefined) return readMcpConnectionReady(reply)
    const exited = input.exit()
    if (exited && (exited.code !== 0 || exited.signal !== null)) {
      throw new Error(`Electron 未完成 MCP 启动，退出状态：${exited.signal ?? exited.code}`)
    }
    if (now() - started >= (input.timeoutMs ?? 60_000)) {
      throw new Error('等待 MCP ready 超时：未收到 listener 与工作空间授权根就绪回执')
    }
    await pause(50)
  }
}

export function readMcpConnectionReady(value: unknown): McpConnectionReady {
  if (!value || typeof value !== 'object') throw new Error('MCP 连接配置不是 JSON 对象')
  const reply = value as Record<string, unknown>
  if (reply.status === 'failed') throw new Error(typeof reply.message === 'string' ? reply.message : 'MCP 启动失败')
  for (const field of ['endpoint', 'token', 'workspace', 'workspaceId', 'profile', 'requestedWorkspace']) {
    if (typeof reply[field] !== 'string' || !reply[field]) throw new Error(`MCP ready 缺少 ${field}`)
  }
  if (reply.status !== 'ready' || !Number.isSafeInteger(reply.pid) || Number(reply.pid) <= 0
    || (reply.mode !== 'headless' && reply.mode !== 'gui')
    || (reply.ownership !== 'owned' && reply.ownership !== 'attached') || typeof reply.workspaceMismatch !== 'boolean') {
    throw new Error('MCP ready 的宿主状态无效')
  }
  executionPermissionModeSchema.parse(reply.permission)
  const endpoint = new URL(String(reply.endpoint))
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('MCP endpoint 必须使用 HTTP 传输')
  return reply as unknown as McpConnectionReady
}
