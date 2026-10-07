import path from 'node:path'
import { externalMcpPortSchema } from '../src/shared/workbench/external'
import { executionPermissionModeSchema } from '../src/shared/workbench/executionPermission'

export { readMcpConnectionReady, waitForMcpConnection, type McpConnectionReady } from '../src/shared/workbench/mcpConnection'

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
