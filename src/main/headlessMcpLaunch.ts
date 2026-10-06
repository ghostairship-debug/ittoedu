import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import { externalMcpPortSchema } from '../shared/workbench/external'
import { executionPermissionModeSchema, type ExecutionPermissionMode } from '../shared/workbench/executionPermission'

export interface HeadlessMcpLaunch {
  workspace: string
  port?: number
  permission?: ExecutionPermissionMode
  readyJson: boolean
  readyFile?: string
}

/** Only an explicit headless launch grants a root. A second launch never changes its owner's root. */
export function parseHeadlessMcpLaunch(argv: readonly string[]): HeadlessMcpLaunch | null {
  if (!argv.includes('--headless-mcp')) return null
  const value = (name: string): string | undefined => {
    const item = argv.find(argument => argument.startsWith(`${name}=`))
    if (item) return item.slice(name.length + 1)
    const index = argv.indexOf(name)
    if (index < 0) return undefined
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${name}`)
    return next
  }
  const workspace = value('--workspace')
  if (!workspace || !path.isAbsolute(workspace)) throw new Error('--workspace 必须是明确授权的绝对目录')
  const port = value('--port'), permission = value('--permission'), readyFile = value('--mcp-ready-file')
  if (readyFile && !path.isAbsolute(readyFile)) throw new Error('--mcp-ready-file 必须是绝对路径')
  return { workspace: path.resolve(workspace), ...(port ? { port: externalMcpPortSchema.parse(Number(port)) } : {}),
    ...(permission ? { permission: executionPermissionModeSchema.parse(permission) } : {}),
    readyJson: argv.includes('--ready-json'), ...(readyFile ? { readyFile } : {}) }
}

/** Owner-controlled, one-use local handoff. No token discovery HTTP route or persistent cleartext token. */
export async function writeMcpLaunchReply(filename: string, reply: unknown): Promise<void> {
  const parent = await fs.realpath(path.dirname(filename)), temporaryRoot = await fs.realpath(os.tmpdir())
  const relative = path.relative(temporaryRoot, parent)
  if (path.basename(filename) !== 'ready.json' || path.dirname(relative) !== '.'
    || !/^guoling-mcp-connect-[A-Za-z0-9_-]+$/.test(path.basename(parent)))
    throw new Error('连接信息只能交接到 launcher 创建的一次性目录')
  const temporary = path.join(parent, 'ready.tmp')
  const handle = await fs.open(temporary, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify(reply)); await handle.sync() } finally { await handle.close() }
  await fs.rename(temporary, path.join(parent, 'ready.json'))
}
