import { executionPermissionModeSchema, type ExecutionPermissionMode } from './executionPermission'

/** Connection facts returned by the resident owner, including when this launch attached. */
export interface McpConnectionReady {
  status: 'ready'
  endpoint: string
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
  for (const field of ['endpoint', 'workspace', 'workspaceId', 'profile', 'requestedWorkspace']) {
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


