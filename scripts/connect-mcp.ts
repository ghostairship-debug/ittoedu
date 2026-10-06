import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { connectExplicitMcp, readExplicitMcpConnection, requireCurrentProjectSave } from './mcpSdkClient'

const usage = 'tsx scripts/connect-mcp.ts --connection "<ready JSON文件>" --file "<已有课件绝对路径>" [--apply "<project.apply参数JSON文件>"] [--save]\n也可显式配置 --endpoint/--token 或 GUOLING_MCP_ENDPOINT/GUOLING_MCP_TOKEN；此样例断开后保留宿主。'

async function main(): Promise<void> {
  const options = new Map<string, string>()
  let save = false
  for (let index = 2; index < process.argv.length; index++) {
    const argument = process.argv[index]!
    if (argument === '--help') { process.stderr.write(`${usage}\n`); return }
    if (argument === '--save') { save = true; continue }
    const name = argument.split('=', 1)[0]!
    if (!['--connection', '--endpoint', '--token', '--workspace-id', '--file', '--apply'].includes(name)) throw new Error(`未知参数：${name}`)
    const value = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : process.argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`${name} 需要参数`)
    options.set(name, value)
  }
  const file = options.get('--file')
  if (!file || !path.isAbsolute(file)) throw new Error('--file 必须指定已有课件的绝对路径')
  const filename = await realpath(file)
  const configuration: unknown = options.has('--connection') ? JSON.parse(await readFile(options.get('--connection')!, 'utf8')) : {
    endpoint: options.get('--endpoint') ?? process.env.GUOLING_MCP_ENDPOINT,
    token: options.get('--token') ?? process.env.GUOLING_MCP_TOKEN,
    workspaceId: options.get('--workspace-id'),
  }
  const connection = readExplicitMcpConnection(configuration)
  const sdk = await connectExplicitMcp(connection)
  process.stdout.write(`${JSON.stringify({ stage: 'client.connect', status: 'completed' })}\n`)
  const call = async (name: string, input: Record<string, unknown> = {}) => {
    const reply = await sdk.call(name, input)
    const structuredContent = reply.structuredContent
    const result = structuredContent && typeof structuredContent === 'object' && 'result' in structuredContent ? structuredContent.result : undefined
    // Keep the complete commit/usability/receipt and save revisions; never truncate the only transaction fact.
    process.stdout.write(`${JSON.stringify({ stage: name, isError: reply.isError === true, structuredContent: reply.structuredContent,
      ...(result === undefined ? { content: reply.content } : {}) })}\n`)
    if (reply.isError || !result || typeof result !== 'object' || !('kind' in result) || result.kind === 'error') throw new Error(`${name} 未完成；以上输出保留实际阶段与回执`)
    return result
  }
  try {
    if (connection.workspaceId) await call('workspace.switch', { workspaceId: connection.workspaceId })
    const opened = await call('file.open', { path: filename })
    if (!('data' in opened) || !opened.data || typeof opened.data !== 'object' || !('target' in opened.data) || typeof opened.data.target !== 'string') {
      throw new Error('file.open 未返回正式文档 target')
    }
    const project = opened.data.target
    await call('tools.load', { families: ['content'] })
    await call('project.list', { project })
    if (options.has('--apply')) {
      const input: unknown = JSON.parse(await readFile(options.get('--apply')!, 'utf8'))
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('--apply 文件必须是 project.apply 的参数 JSON 对象')
      const applied = await call('project.apply', { ...input, project })
      if (!('data' in applied) || !applied.data || typeof applied.data !== 'object' || !('commit' in applied.data)
        || !['committed', 'unchanged'].includes(String(applied.data.commit))) throw new Error('project.apply 未确认提交；请保留源码、诊断与恢复事实')
    }
    if (save) requireCurrentProjectSave(await call('project.save', { project }), filename)
  } finally {
    await sdk.detach()
    process.stdout.write(`${JSON.stringify({ stage: 'client.detach', status: 'completed', hostStopped: false })}\n`)
  }
}

main().catch(error => {
  process.stderr.write(`MCP SDK 样例失败：${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
