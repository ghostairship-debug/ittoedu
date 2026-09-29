import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parsePublicUrl } from '../network/publicHttp'
import { PublicBrowserProxy } from '../network/PublicBrowserProxy'
import { McpClientService, type McpCallResult, type McpDiscovery } from './McpClientService'

const browserTools = [
  { name: 'browser_navigate', effect: 'read' },
  { name: 'browser_snapshot', effect: 'read' },
  { name: 'browser_find', effect: 'read' },
  { name: 'browser_take_screenshot', effect: 'read' },
  { name: 'browser_wait_for', effect: 'read' },
  { name: 'browser_click', effect: 'write' },
  { name: 'browser_type', effect: 'write' },
  { name: 'browser_file_upload', effect: 'write' },
] as const
export type ManagedBrowserTool = typeof browserTools[number]['name']
export const managedBrowserWriteTools = ['browser_click', 'browser_type', 'browser_file_upload'] as const
export type ManagedBrowserResult = McpCallResult & { snapshotId?: string; downloads?: readonly BrowserDownload[] }
export interface BrowserDownload { resourceId: string; name: string; mimeType: string; byteLength: number }

export interface ManagedBrowserGrant {
  permission: 'read-only' | 'ask-before-edit' | 'workspace-write' | 'full-access'
  /** Frozen task origins. The default public policy may be used for open-web research. */
  allowedOrigins?: readonly string[]
  allowPublicNavigation?: boolean
  /** Only files whose real path remains beneath this root can become upload resources. */
  uploadRoot?: string
}

export interface ManagedBrowserOptions {
  scratchRoot: string
  /** Host-owned, concrete approval for this exact click/input/upload. Missing means deny. */
  approveExternalAction?: (input: { runId: string; tool: ManagedBrowserTool; arguments: Record<string, unknown>;
    operationId: string; pageUrl?: string; snapshotId: string }) => Promise<boolean>
  /** Test-only loopback origin for a server created by the test itself. */
  testLoopbackOrigin?: string
  nodeExecutable?: string
}

interface BrowserRun {
  grant: ManagedBrowserGrant
  scratch: string
  client: McpClientService
  proxy: PublicBrowserProxy
  stopped: boolean
  pageUrl?: string
  snapshotId?: string
  fileChooserSnapshotId?: string
  tail: Promise<unknown>
  results: Map<string, { digest: string; result: Promise<ManagedBrowserResult> }>
  resources: Map<string, { mimeType: string; bytes: Uint8Array }>
  downloads: Set<string>
  pendingApproval?: { tool: string; digest: string }
}

function within(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
function reason(cause: unknown): string { return cause instanceof Error ? cause.message.slice(0, 300) : '受管浏览器操作失败' }
function mime(name: string): string {
  const extension = extname(name).toLowerCase()
  return extension === '.png' ? 'image/png' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg'
    : extension === '.pdf' ? 'application/pdf' : extension === '.html' ? 'text/html'
      : extension === '.json' ? 'application/json' : extension === '.txt' ? 'text/plain' : 'application/octet-stream'
}
function remoteName(name: string): ManagedBrowserTool | null {
  const candidate = name.startsWith('mcp.browser.') ? name.slice('mcp.browser.'.length) : name
  return browserTools.some(tool => tool.name === candidate) ? candidate as ManagedBrowserTool : null
}

/** A task-owned Playwright MCP process; the model never gets its OS path or browser profile. */
export class ManagedBrowserMcpService {
  private readonly runs = new Map<string, BrowserRun>()
  constructor(private readonly options: ManagedBrowserOptions) {
    if (!isAbsolute(options.scratchRoot)) throw new Error('浏览器暂存根必须是绝对路径')
  }

  async beginRun(runId: string, grant: ManagedBrowserGrant): Promise<void> {
    if (!runId || this.runs.has(runId)) throw new Error('浏览器任务身份重复或无效')
    if (grant.uploadRoot && !isAbsolute(grant.uploadRoot)) throw new Error('上传授权根必须是绝对路径')
    const allowedOrigins = (grant.allowedOrigins ?? []).map(value => {
      const parsed = new URL(value)
      if (parsed.href !== `${parsed.origin}/` || !['http:', 'https:'].includes(parsed.protocol)) throw new Error('浏览器来源必须是精确 origin')
      if (parsed.origin !== this.options.testLoopbackOrigin) parsePublicUrl(parsed.href)
      return parsed.origin
    })
    await fs.mkdir(this.options.scratchRoot, { recursive: true })
    const root = await fs.realpath(this.options.scratchRoot)
    const scratch = await fs.mkdtemp(join(root, 'browser-run-'))
    const proxy = new PublicBrowserProxy({ testLoopbackOrigin: this.options.testLoopbackOrigin })
    let proxyUrl: string
    try { proxyUrl = await proxy.start() }
    catch (error) { await fs.rm(scratch, { recursive: true, force: true }); throw error }
    const packageRoot = dirname(require.resolve('@playwright/mcp/package.json'))
    const client = new McpClientService({ connection: { namespace: 'browser',
      transport: { kind: 'stdio', command: this.options.nodeExecutable ?? process.execPath,
        args: [join(packageRoot, 'cli.js'), '--browser=msedge', '--headless', '--isolated', '--no-webmcp', '--block-service-workers',
          '--timeout-navigation=15000', '--timeout-action=5000', `--output-dir=${scratch}`, `--proxy-server=${proxyUrl}`,
          '--proxy-bypass=<-loopback>',
          ...(allowedOrigins.length ? [`--allowed-origins=${allowedOrigins.join(';')}`] : [])],
        cwd: scratch, env: { ELECTRON_RUN_AS_NODE: '1' } },
      tools: browserTools },
      // Navigation is independently checked below. This guard prevents accidental direct invocation bypass.
      authorizeCall: async ({ tool, arguments: args }) => tool !== 'browser_navigate' || this.allowedUrl(grant, args.url, allowedOrigins),
      authorizeWrite: async ({ runId: currentRunId, tool, arguments: args }) => {
        const pending = this.runs.get(currentRunId)?.pendingApproval
        return pending?.tool === tool && pending.digest === createHash('sha256').update(JSON.stringify(args)).digest('hex')
      },
    })
    const visible = browserTools.filter(tool => tool.effect === 'read'
      || grant.permission !== 'read-only' && !!this.options.approveExternalAction)
    try { client.beginRun(runId, { allowedTools: visible.map(tool => tool.name), writeAllowed: true }) }
    catch (error) { await proxy.stop(); await fs.rm(scratch, { recursive: true, force: true }); throw error }
    this.runs.set(runId, { grant: { ...grant, allowedOrigins }, scratch, client, proxy, stopped: false,
      tail: Promise.resolve(), results: new Map(), resources: new Map(), downloads: new Set() })
  }

  private allowedUrl(grant: ManagedBrowserGrant, raw: unknown, allowed: readonly string[] = grant.allowedOrigins ?? []): boolean {
    if (typeof raw !== 'string' || raw.length > 2048) return false
    try {
      const url = new URL(raw)
      if (url.origin === this.options.testLoopbackOrigin) return true
      parsePublicUrl(raw)
      return allowed.includes(url.origin) || grant.allowPublicNavigation === true
    } catch { return false }
  }

  private run(runId: string): BrowserRun {
    const run = this.runs.get(runId)
    if (!run) throw new Error('浏览器任务尚未授权')
    return run
  }

  /** Host-observed page identity for the product's exact-action approval prompt. */
  approvalContext(runId: string): { pageUrl?: string; snapshotId?: string } {
    const run = this.run(runId)
    if (run.stopped) throw new Error('浏览器任务已停止')
    return { ...(run.pageUrl ? { pageUrl: run.pageUrl } : {}),
      ...((run.snapshotId ?? run.fileChooserSnapshotId) ? { snapshotId: run.snapshotId ?? run.fileChooserSnapshotId } : {}) }
  }

  /** Local diagnostic only: verifies that denied requests reached the per-run egress guard. */
  egressStats(runId: string): { deniedRequests: number; allowedRequests: number } { return this.run(runId).proxy.stats() }

  async discover(runId: string, signal?: AbortSignal): Promise<McpDiscovery> {
    const run = this.run(runId)
    if (run.stopped) return { status: 'stopped', reason: '任务已停止' }
    const found = await run.client.discover(runId, signal)
    if (found.status !== 'available') return found
    // Expose only the curated contract. Browser MCP may offer more tools, including process-level unsafe code.
    return { status: 'available', tools: found.tools.map(tool => {
      if (tool.effect !== 'write') return tool
      const source = tool.inputSchema
      const properties = source.properties && typeof source.properties === 'object' ? source.properties as Record<string, unknown> : {}
      return { ...tool, inputSchema: { ...source,
        properties: { ...(tool.remoteName === 'browser_file_upload'
          ? { paths: { type: 'array', items: { type: 'string' }, description: '授权根下的相对文件路径' } }
          : properties), snapshotId: { type: 'string', description: '最近一次 browser_snapshot 返回的页面观察身份' } },
        required: [...new Set([...(Array.isArray(source.required) ? source.required as string[] : []),
          ...(tool.remoteName === 'browser_file_upload' ? ['paths'] : []), 'snapshotId'])], additionalProperties: false } }
    }) }
  }

  invoke(input: { runId: string; operationId: string; name: string; arguments: Record<string, unknown>;
    snapshotId?: string; signal?: AbortSignal }): Promise<ManagedBrowserResult> {
    const run = this.run(input.runId)
    const reject = (why: string): ManagedBrowserResult => ({ status: 'rejected', service: 'browser', tool: input.name,
      operationId: input.operationId, reason: why })
    if (!input.operationId || input.operationId.length > 512 || !input.arguments || typeof input.arguments !== 'object'
      || Array.isArray(input.arguments)) return Promise.resolve(reject('浏览器操作身份或参数无效'))
    const args = { ...input.arguments }
    const snapshotId = input.snapshotId ?? (typeof args.snapshotId === 'string' ? args.snapshotId : undefined)
    delete args.snapshotId
    const normalized = { ...input, arguments: args, snapshotId }
    const digest = createHash('sha256').update(JSON.stringify([input.name, args, snapshotId])).digest('hex')
    const prior = run.results.get(input.operationId)
    if (prior) return prior.digest === digest ? prior.result : Promise.resolve(reject('同一操作身份不能改变参数'))
    const work = run.tail.then(() => this.perform(run, normalized), () => this.perform(run, normalized))
    run.tail = work.catch(() => undefined)
    run.results.set(input.operationId, { digest, result: work })
    return work
  }

  private validateArgs(tool: ManagedBrowserTool, args: Record<string, unknown>): boolean {
    const keys: Record<ManagedBrowserTool, readonly string[]> = {
      browser_navigate: ['url'], browser_snapshot: ['target', 'depth', 'boxes'], browser_find: ['text', 'regex'],
      browser_take_screenshot: ['element', 'target', 'type', 'fullPage', 'scale'],
      browser_wait_for: ['text', 'textGone', 'time'], browser_click: ['element', 'target', 'button', 'doubleClick', 'modifiers'],
      browser_type: ['element', 'target', 'text', 'submit', 'slowly'], browser_file_upload: ['paths'],
    }
    if (Object.keys(args).some(key => !keys[tool].includes(key))) return false
    if (tool === 'browser_navigate') return typeof args.url === 'string'
    if (tool === 'browser_click') return typeof args.target === 'string' && args.target.length > 0 && args.target.length < 1000
    if (tool === 'browser_type') return typeof args.target === 'string' && typeof args.text === 'string' && args.text.length <= 20_000
    if (tool === 'browser_file_upload') return Array.isArray(args.paths) && args.paths.length > 0 && args.paths.length <= 4
      && args.paths.every(path => typeof path === 'string' && path.length > 0 && path.length < 1000)
    if (tool === 'browser_wait_for') return args.time === undefined || typeof args.time === 'number' && args.time >= 0 && args.time <= 30
    return true
  }

  private async stageUploads(run: BrowserRun, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!run.grant.uploadRoot) throw new Error('本任务没有上传授权根')
    const root = await fs.realpath(run.grant.uploadRoot)
    const paths: string[] = []
    const staged = join(run.scratch, 'uploads')
    await fs.mkdir(staged, { recursive: true })
    for (const entry of args.paths as string[]) {
      if (isAbsolute(entry) || entry.split(/[\\/]/).includes('..')) throw new Error('上传仅接受授权根下相对路径')
      const source = await fs.realpath(resolve(root, entry))
      if (!within(root, source)) throw new Error('上传来源超出授权根')
      const stat = await fs.stat(source)
      if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('上传来源不是受支持的普通文件')
      const bytes = await fs.readFile(source)
      if (bytes.byteLength !== stat.size) throw new Error('上传来源在读取期间改变')
      const dest = join(staged, `${randomUUID()}-${basename(source)}`)
      await fs.writeFile(dest, bytes, { flag: 'wx' })
      paths.push(dest)
    }
    return { paths }
  }

  private async collectDownloads(run: BrowserRun, before: ReadonlySet<string>, result: McpCallResult): Promise<BrowserDownload[]> {
    const out: BrowserDownload[] = []
    const announced = new Set<string>()
    if (result.status === 'returned') for (const item of result.content) if (item.type === 'text') {
      for (const match of item.text.matchAll(/(?:^|\n)- Downloaded file [^\n]*? to "(?:\.\/)?([^"\\/]+)"/g)) announced.add(match[1]!)
    }
    for (const name of announced) {
      if (name === 'uploads' || before.has(name) || run.downloads.has(name)) continue
      const path = join(run.scratch, name)
      const stat = await fs.lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20 * 1024 * 1024) continue
      const actual = await fs.realpath(path)
      if (!within(run.scratch, actual)) continue
      const bytes = await fs.readFile(actual)
      if (bytes.length !== stat.size) continue
      const resourceId = randomUUID()
      run.resources.set(resourceId, { mimeType: mime(name), bytes })
      run.downloads.add(name)
      out.push({ resourceId, name, mimeType: mime(name), byteLength: bytes.length })
    }
    return out
  }

  private observedUrl(result: McpCallResult): string | undefined {
    if (result.status !== 'returned') return undefined
    for (const item of result.content) if (item.type === 'text') {
      const found = item.text.match(/(?:^|\n)\s*-?\s*Page URL:\s*(\S+)/i)
      if (found) return found[1]
    }
    return undefined
  }

  private async perform(run: BrowserRun, input: { runId: string; operationId: string; name: string;
    arguments: Record<string, unknown>; snapshotId?: string; signal?: AbortSignal }): Promise<ManagedBrowserResult> {
    const reject = (why: string): ManagedBrowserResult => ({ status: 'rejected', service: 'browser', tool: input.name,
      operationId: input.operationId, reason: why })
    if (run.stopped || input.signal?.aborted) return reject('任务已停止')
    const tool = remoteName(input.name)
    if (!tool || !this.validateArgs(tool, input.arguments)) return reject('浏览器工具或参数超出受管白名单')
    const effect = browserTools.find(item => item.name === tool)!.effect
    if (tool === 'browser_navigate' && !this.allowedUrl(run.grant, input.arguments.url)) return reject('网页地址不在本任务授权范围')
    if (effect === 'write') {
      if (run.grant.permission === 'read-only') return reject('只读任务不能操作外部页面')
      const observed = tool === 'browser_file_upload' && run.fileChooserSnapshotId === input.snapshotId
        || !!run.snapshotId && input.snapshotId === run.snapshotId
      if (!observed) return reject('页面观察已失效，请重新读取当前页面')
      if (!this.options.approveExternalAction) return reject('缺少本次外部页面操作的明确授权')
      let approved = false
      try { approved = await this.options.approveExternalAction({ runId: input.runId, operationId: input.operationId, tool,
        arguments: structuredClone(input.arguments), ...(run.pageUrl ? { pageUrl: run.pageUrl } : {}), snapshotId: input.snapshotId! }) }
      catch { return reject('无法核对本次外部页面操作授权') }
      if (!approved) return reject('本次外部页面操作未获授权')
    }
    if (run.stopped || input.signal?.aborted) return reject('任务已停止')
    let remoteArgs = input.arguments
    if (tool === 'browser_file_upload') {
      try { remoteArgs = await this.stageUploads(run, input.arguments) }
      catch (cause) { return reject(reason(cause)) }
    }
    // The generic MCP write gate only opens for the exact, already approved operation.
    const before = effect === 'write' ? new Set(await fs.readdir(run.scratch)) : new Set<string>()
    if (effect === 'write') run.pendingApproval = { tool, digest: createHash('sha256').update(JSON.stringify(remoteArgs)).digest('hex') }
    let result: McpCallResult
    try {
      result = await run.client.invoke({ runId: input.runId, operationId: input.operationId,
        name: `mcp.browser.${tool}`, arguments: remoteArgs, signal: input.signal })
    } finally { run.pendingApproval = undefined }
    if (run.stopped) return { status: 'unknown', service: 'browser', tool: input.name,
      operationId: input.operationId, reason: '浏览器停止后结果待核对' }
    const observed = this.observedUrl(result)
    if (observed && !this.allowedUrl(run.grant, observed)) {
      await this.stopRun(input.runId)
      return { status: 'failed', service: 'browser', tool: input.name, operationId: input.operationId,
        reason: '浏览器转到了任务未授权的来源，已停止会话' }
    }
    if (observed) run.pageUrl = observed
    if (result.status === 'returned') {
      if (tool === 'browser_click') run.fileChooserSnapshotId = input.snapshotId
      else if (effect === 'write' || tool === 'browser_navigate') run.fileChooserSnapshotId = undefined
      if (effect === 'write' || tool === 'browser_navigate') run.snapshotId = undefined
      if (tool === 'browser_snapshot') run.snapshotId = randomUUID()
      const downloads = effect === 'write' ? await this.collectDownloads(run, before, result) : []
      return { ...result, ...(run.snapshotId && tool === 'browser_snapshot' ? { snapshotId: run.snapshotId } : {}),
        ...(downloads.length ? { downloads } : {}) }
    }
    return result
  }

  readResource(runId: string, resourceId: string): { mimeType: string; bytes: Uint8Array } {
    const run = this.run(runId)
    if (run.stopped) throw new Error('任务已停止')
    const download = run.resources.get(resourceId)
    return download ? { mimeType: download.mimeType, bytes: new Uint8Array(download.bytes) }
      : run.client.readResource(runId, resourceId)
  }

  lookup(runId: string, operationId: string): Promise<ManagedBrowserResult | null> {
    return this.run(runId).results.get(operationId)?.result ?? Promise.resolve(null)
  }

  async stopRun(runId: string): Promise<void> {
    const run = this.runs.get(runId)
    if (!run || run.stopped) return
    run.stopped = true
    run.resources.clear()
    await run.proxy.stop()
    await run.client.stopRun(runId)
    const root = await fs.realpath(this.options.scratchRoot)
    const target = await fs.realpath(run.scratch).catch(() => undefined)
    if (target && within(root, target) && target !== root) await fs.rm(target, { recursive: true, force: true })
  }

  async endRun(runId: string): Promise<void> {
    const run = this.runs.get(runId)
    if (!run) return
    await this.stopRun(runId)
    await run.client.endRun(runId)
    this.runs.delete(runId)
  }
}
