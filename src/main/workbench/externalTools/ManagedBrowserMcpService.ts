import { managedBrowserWindowCode, type ManagedBrowserControlState } from './managedBrowserControlCode'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parsePublicUrl } from '../network/publicHttp'
import { PublicBrowserProxy } from '../network/PublicBrowserProxy'
import { McpClientService, type McpCallResult, type McpDiscovery } from './McpClientService'
import type { EmbeddedBrowserBackend, EmbeddedBrowserBackendFactory } from '../browserEmbedded/EmbeddedBrowserBackend'
import type { EmbeddedBrowserViewport, EmbeddedBrowserViewportState } from '../../../shared/workbench/embeddedBrowser'

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
export type ManagedBrowserResult = McpCallResult & { snapshotId?: string; downloads?: readonly BrowserDownload[]; downloadIssues?: readonly { name: string; reason: string }[] }
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
  /** Product backend: display and automation address the same Electron task page. */
  embeddedBackend?: EmbeddedBrowserBackendFactory
  /** Explicit legacy connection for callers that intentionally use an external Edge window. */
  externalBackend?: 'edge-mcp'
  /** Host-owned, concrete approval for this exact click/input/upload. Missing means deny. */
  approveExternalAction?: (input: { runId: string; tool: ManagedBrowserTool; arguments: Record<string, unknown>;
    operationId: string; pageUrl?: string; snapshotId: string }) => Promise<boolean>
  /** Test-only loopback origin for a server created by the test itself. */
  testLoopbackOrigin?: string
  nodeExecutable?: string
}

interface BrowserRun {
  grant: ManagedBrowserGrant
  scratch?: string
  client?: McpClientService
  embedded?: EmbeddedBrowserBackend
  proxy?: PublicBrowserProxy
  stopped: boolean
  used?: boolean
  control: ManagedBrowserControlState['state']
  controlGeneration: number
  controls?: Promise<ManagedBrowserControlState>
  controlWaiters: Set<() => void>
  pageUrl?: string
  snapshotId?: string
  fileChooserSnapshotId?: string
  tail: Promise<unknown>
  activeOperation?: AbortController
  results: Map<string, { digest: string; result: Promise<ManagedBrowserResult> }>
  resources: Map<string, { mimeType: string; filename: string; byteLength: number }>
  downloads: Set<string>
  preserveScratch?: boolean
  pendingApproval?: { tool: string; digest: string }
  prepared?: Promise<void>
  prepareError?: Error
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
    // Lazy: do not touch scratchRoot, spawn MCP or bind the proxy until the task actually uses the browser.
    this.runs.set(runId, { grant: { ...grant, allowedOrigins }, stopped: false, control: 'agent',
      controlGeneration: 0, controlWaiters: new Set(),
      tail: Promise.resolve(), results: new Map(), resources: new Map(), downloads: new Set() })
  }

  private ensurePrepared(runId: string, run: BrowserRun): Promise<void> {
    if (run.prepareError) return Promise.reject(run.prepareError)
    if (run.prepared) return run.prepared
    run.prepared = this.prepare(runId, run).catch(cause => {
      const error = cause instanceof Error ? cause : new Error('受管浏览器准备失败')
      run.prepareError = error
      throw error
    })
    return run.prepared
  }

  private async prepare(runId: string, run: BrowserRun): Promise<void> {
    if (!this.options.embeddedBackend && this.options.externalBackend !== 'edge-mcp') throw new Error('任务浏览器尚未配置内嵌页面后端')
    const grant = run.grant
    const allowedOrigins = grant.allowedOrigins ?? []
    await fs.mkdir(this.options.scratchRoot, { recursive: true })
    const root = await fs.realpath(this.options.scratchRoot)
    const scratch = await fs.mkdtemp(join(root, 'browser-run-'))
    const proxy = new PublicBrowserProxy({ testLoopbackOrigin: this.options.testLoopbackOrigin })
    let proxyUrl: string
    try { proxyUrl = await proxy.start() }
    catch (error) { await fs.rm(scratch, { recursive: true, force: true }); throw error }
    if (this.options.embeddedBackend) {
      run.scratch = scratch
      run.proxy = proxy
      try {
        run.embedded = await this.options.embeddedBackend({ runId, scratch, proxyUrl,
          allowedUrl: url => this.allowedUrl(grant, url),
          onPageChanged: url => {
            run.pageUrl = url === 'about:blank' ? undefined : url
            run.snapshotId = undefined; run.fileChooserSnapshotId = undefined; run.pendingApproval = undefined
          } })
      } catch (error) { await proxy.stop(); await fs.rm(scratch, { recursive: true, force: true }); throw error }
      return
    }
    const packageRoot = dirname(require.resolve('@playwright/mcp/package.json'))
    const configFile = join(scratch, 'host-browser-config.json')
    await fs.writeFile(configFile, JSON.stringify({ browser: { isolated: true, launchOptions: { headless: false,
      args: ['--window-position=-32000,-32000'] } } }), { flag: 'wx' })
    const privateTools = [{ name: 'browser_run_code_unsafe', effect: 'write' as const }, { name: 'browser_close', effect: 'read' as const }]
    const client = new McpClientService({ connection: { namespace: 'browser',
      transport: { kind: 'stdio', command: this.options.nodeExecutable ?? process.execPath,
        args: [join(packageRoot, 'cli.js'), '--browser=msedge', `--config=${configFile}`, '--isolated', '--no-webmcp', '--block-service-workers',
          '--timeout-navigation=0', '--timeout-action=0', `--output-dir=${scratch}`, `--proxy-server=${proxyUrl}`,
          '--proxy-bypass=<-loopback>',
          ...(allowedOrigins.length ? [`--allowed-origins=${allowedOrigins.join(';')}`] : [])],
        cwd: scratch, env: { ELECTRON_RUN_AS_NODE: '1' } },
      tools: [...browserTools, ...privateTools] },
      // Navigation is independently checked below. This guard prevents accidental direct invocation bypass.
      authorizeCall: async ({ tool, arguments: args }) => tool !== 'browser_navigate' || this.allowedUrl(grant, args.url, allowedOrigins),
      authorizeWrite: async ({ runId: currentRunId, tool, arguments: args }) => {
        const pending = this.runs.get(currentRunId)?.pendingApproval
        return pending?.tool === tool && pending.digest === createHash('sha256').update(JSON.stringify(args)).digest('hex')
      },
    })
    const visible = browserTools.filter(tool => tool.effect === 'read'
      || grant.permission !== 'read-only' && !!this.options.approveExternalAction)
    try { client.beginRun(runId, { allowedTools: [...visible, ...privateTools].map(tool => tool.name), writeAllowed: true }) }
    catch (error) { await proxy.stop(); await fs.rm(scratch, { recursive: true, force: true }); throw error }
    run.scratch = scratch
    run.client = client
    run.proxy = proxy
  }

  private allowedUrl(grant: ManagedBrowserGrant, raw: unknown, allowed: readonly string[] = grant.allowedOrigins ?? []): boolean {
    if (typeof raw !== 'string') return false
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

  controlState(runId: string): ManagedBrowserControlState {
    const run = this.run(runId)
    return { state: run.stopped ? 'stopped' : run.control, ...(run.pageUrl ? { pageUrl: run.pageUrl } : {}),
      ...(run.snapshotId ? { snapshotId: run.snapshotId } : {}) }
  }

  /** View changes never navigate, create a second page, or end the task session. */
  viewport(runId: string, input: EmbeddedBrowserViewport): EmbeddedBrowserViewportState {
    const run = this.run(runId)
    if (run.stopped) throw new Error('浏览器任务已停止')
    if (!run.embedded) return { embedded: false, visible: false, ...(run.pageUrl ? { pageUrl: run.pageUrl } : {}) }
    if (input.visible && !run.pageUrl) throw new Error('本任务尚未打开可显示的网页。')
    return run.embedded.viewport(input)
  }

  /** No arbitrary code or credential export: this entry only shows/hides the existing task browser. */
  async control(runId: string, action: 'takeover' | 'resume'): Promise<ManagedBrowserControlState> {
    const run = this.run(runId)
    if (run.stopped) throw new Error('浏览器任务已停止')
    if (run.controls) throw new Error('浏览器接管正在切换，请等待当前操作结束')
    if (action === 'resume' && run.control === 'agent') return this.controlState(runId)
    if (action === 'takeover' && !run.pageUrl) throw new Error('本任务尚未打开可接管的网页。')
    run.control = 'transition'; run.controlGeneration++
    if (action === 'takeover') run.activeOperation?.abort(new Error('用户正在接管当前网页'))
    run.snapshotId = undefined; run.fileChooserSnapshotId = undefined; run.pendingApproval = undefined
    const control = (async () => {
      await this.ensurePrepared(runId, run)
      await run.tail.catch(() => undefined)
      if (run.stopped) throw new Error('任务已停止')
      run.snapshotId = undefined; run.fileChooserSnapshotId = undefined; run.pendingApproval = undefined
      run.used = true
      await this.setBackendControl(runId, run, action === 'takeover')
      if (run.stopped) throw new Error('任务已停止')
      if (action === 'resume') {
        const result = await this.perform(run, { runId, operationId: `host-return-observe-${randomUUID()}`,
          name: 'mcp.browser.browser_snapshot', arguments: {} })
        if (result.status !== 'returned' || !result.snapshotId) throw new Error('返回后的页面尚未重新观察，任务仍暂停')
      }
      run.control = action === 'takeover' ? 'human' : 'agent'
      for (const notify of [...run.controlWaiters]) notify()
      return this.controlState(runId)
    })()
    run.controls = control
    try { return await control }
    catch (error) {
      if (!run.stopped) {
        run.snapshotId = undefined; run.fileChooserSnapshotId = undefined; run.pendingApproval = undefined
        // Resume may already have disabled native human input before observing fails.
        // Report human ownership only after restoring the same backend's real control.
        try {
          await this.setBackendControl(runId, run, true)
          if (!run.stopped) run.control = 'human'
        } catch (restoreError) {
          if (!run.stopped) run.control = 'transition'
          throw new Error(`${reason(error)}；人工控制尚未恢复：${reason(restoreError)}。请显示当前网页后重试接管或停止。`)
        }
      }
      throw error
    }
    finally { if (run.controls === control) run.controls = undefined }
  }

  private async setBackendControl(runId: string, run: BrowserRun, human: boolean): Promise<void> {
    if (run.stopped) throw new Error('任务已停止')
    if (run.embedded) { await run.embedded.control(human); return }
    if (!run.client) throw new Error('任务浏览器尚未就绪')
    const args = { code: managedBrowserWindowCode[human ? 'show' : 'hide'] }
    run.pendingApproval = { tool: 'browser_run_code_unsafe', digest: createHash('sha256').update(JSON.stringify(args)).digest('hex') }
    try {
      const reply = await run.client.invoke({ runId, operationId: `host-window-${randomUUID()}`,
        name: 'mcp.browser.browser_run_code_unsafe', arguments: args })
      if (reply.status !== 'returned') throw new Error('未能切换原受管浏览器窗口；任务保持暂停，可再次尝试或停止')
    } finally { run.pendingApproval = undefined }
  }

  /** Local diagnostic only: verifies that denied requests reached the per-run egress guard. */
  egressStats(runId: string): { deniedRequests: number; allowedRequests: number } {
    const run = this.run(runId)
    if (!run.proxy) {
      if (run.prepareError) throw run.prepareError
      throw new Error('受管浏览器尚未就绪')
    }
    return run.proxy.stats()
  }

  async discover(runId: string, signal?: AbortSignal): Promise<McpDiscovery> {
    const run = this.run(runId)
    if (run.stopped) return { status: 'stopped', reason: '任务已停止' }
    try { await this.ensurePrepared(runId, run) }
    catch (cause) { return { status: 'failed', reason: reason(cause) } }
    if (run.stopped) return { status: 'stopped', reason: '任务已停止' }
    const found = run.embedded
      ? await run.embedded.discover(run.grant.permission !== 'read-only' && !!this.options.approveExternalAction)
      : await run.client!.discover(runId, signal)
    if (found.status !== 'available') return found
    // Expose only the curated contract. Browser MCP may offer more tools, including process-level unsafe code.
    return { status: 'available', tools: found.tools.filter(tool => remoteName(tool.remoteName)).map(tool => {
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
    if (!input.operationId || !input.arguments || typeof input.arguments !== 'object'
      || Array.isArray(input.arguments)) return Promise.resolve(reject('浏览器操作身份或参数无效'))
    const args = { ...input.arguments }
    const snapshotId = input.snapshotId ?? (typeof args.snapshotId === 'string' ? args.snapshotId : undefined)
    delete args.snapshotId
    const normalized = { ...input, arguments: args, snapshotId }
    const digest = createHash('sha256').update(JSON.stringify([input.name, args, snapshotId])).digest('hex')
    const prior = run.results.get(input.operationId)
    if (prior) return prior.digest === digest ? prior.result : Promise.resolve(reject('同一操作身份不能改变参数'))
    const tool = remoteName(input.name)
    if (!tool || !this.validateArgs(tool, args)) return Promise.resolve(reject('浏览器工具或参数超出受管白名单'))
    const generation = run.controlGeneration
    const work = (async () => {
      // Wait outside the operation tail: resume itself must be able to acquire that
      // tail, show the existing session, and refresh observations without deadlock.
      while (!run.stopped && !input.signal?.aborted && run.control !== 'agent') {
        await new Promise<void>(resolve => {
          const finish = () => { run.controlWaiters.delete(check); input.signal?.removeEventListener('abort', finish); resolve() }
          const check = () => { if (run.stopped || input.signal?.aborted || run.control === 'agent') finish() }
          run.controlWaiters.add(check); input.signal?.addEventListener('abort', finish, { once: true }); check()
        })
      }
      if (run.stopped || input.signal?.aborted) return reject('浏览器任务已停止；等待中的动作未执行')
      const perform = async () => {
        if (run.control !== 'agent'
          || generation !== run.controlGeneration && (tool === 'browser_navigate' || browserTools.find(item => item.name === tool)!.effect === 'write'))
          return reject('用户接管后页面已改变，请使用返回后的新观察；原动作未执行')
        const controller = new AbortController()
        const cancel = () => controller.abort(input.signal?.reason)
        input.signal?.addEventListener('abort', cancel, { once: true })
        if (input.signal?.aborted) cancel()
        run.activeOperation = controller
        let dispatched = false
        let finishInterrupt: (() => void) | undefined
        const interrupted = new Promise<ManagedBrowserResult>(resolve => {
          const stop = () => resolve({ status: dispatched && browserTools.find(item => item.name === tool)!.effect === 'write' ? 'unknown' : 'rejected',
            service: 'browser', tool: input.name, operationId: input.operationId,
            reason: dispatched ? '当前浏览器操作已中断；已发出的页面动作需要核对，不能重复执行' : '当前浏览器等待已中断，页面动作未发出' })
          controller.signal.addEventListener('abort', stop, { once: true })
          finishInterrupt = () => controller.signal.removeEventListener('abort', stop)
          if (controller.signal.aborted) stop()
        })
        try { return await Promise.race([this.perform(run, { ...normalized, signal: controller.signal,
          onDispatched: () => { dispatched = true } }), interrupted]) }
        finally {
          finishInterrupt?.()
          input.signal?.removeEventListener('abort', cancel)
          if (run.activeOperation === controller) run.activeOperation = undefined
        }
      }
      const operation = run.tail.then(perform, perform)
      run.tail = operation.catch(() => undefined)
      return operation
    })()
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
    if (tool === 'browser_click') return typeof args.target === 'string' && args.target.length > 0
    if (tool === 'browser_type') return typeof args.target === 'string' && typeof args.text === 'string'
    if (tool === 'browser_file_upload') return Array.isArray(args.paths) && args.paths.length > 0
      && args.paths.every(path => typeof path === 'string' && path.length > 0)
    if (tool === 'browser_wait_for') return args.time === undefined || typeof args.time === 'number' && Number.isFinite(args.time) && args.time >= 0
    return true
  }

  private async stageUploads(run: BrowserRun, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!run.grant.uploadRoot) throw new Error('本任务没有上传授权根')
    const root = await fs.realpath(run.grant.uploadRoot)
    const paths: string[] = []
    const staged = join(run.scratch!, 'uploads')
    await fs.mkdir(staged, { recursive: true })
    for (const entry of args.paths as string[]) {
      if (isAbsolute(entry) || entry.split(/[\\/]/).includes('..')) throw new Error('上传仅接受授权根下相对路径')
      const source = await fs.realpath(resolve(root, entry))
      if (!within(root, source)) throw new Error('上传来源超出授权根')
      const stat = await fs.stat(source)
      if (!stat.isFile()) throw new Error('上传来源不是受支持的普通文件')
      const dest = join(staged, `${randomUUID()}-${basename(source)}`)
      await fs.copyFile(source, dest)
      const after = await fs.stat(source)
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || (await fs.stat(dest)).size !== stat.size) { await fs.rm(dest, { force: true }); throw new Error('上传来源在复制期间改变') }
      paths.push(dest)
    }
    return { paths }
  }

  private async collectDownloads(run: BrowserRun, before: ReadonlySet<string>, result: McpCallResult): Promise<{ downloads: BrowserDownload[]; issues: { name: string; reason: string }[] }> {
    const out: BrowserDownload[] = [], issues: { name: string; reason: string }[] = []
    const announced = new Set<string>()
    if (result.status === 'returned') for (const item of result.content) if (item.type === 'text') {
      for (const match of item.text.matchAll(/(?:^|\n)- Downloaded file [^\n]*? to "(?:\.\/)?([^"\\/]+)"/g)) announced.add(match[1]!)
    }
    for (const name of announced) {
      if (name === 'uploads' || before.has(name) || run.downloads.has(name)) continue
      const path = join(run.scratch!, name)
      const stat = await fs.lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink()) {
        run.preserveScratch = true
        issues.push({ name, reason: `下载保留于 ${run.scratch}；不是普通文件，未登记为完整成果` }); continue
      }
      const actual = await fs.realpath(path)
      if (!within(run.scratch!, actual)) continue
      const resourceId = randomUUID(), sealed = join(run.scratch!, `.resource-${resourceId}`)
      await fs.copyFile(actual, sealed)
      const after = await fs.stat(actual)
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || (await fs.stat(sealed)).size !== stat.size) { await fs.rm(sealed, { force: true }); throw new Error('下载文件在封存期间改变，未登记错误成果') }
      run.resources.set(resourceId, { mimeType: mime(name), filename: sealed, byteLength: stat.size })
      run.downloads.add(name)
      out.push({ resourceId, name, mimeType: mime(name), byteLength: stat.size })
    }
    return { downloads: out, issues }
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
    arguments: Record<string, unknown>; snapshotId?: string; signal?: AbortSignal; onDispatched?: () => void }): Promise<ManagedBrowserResult> {
    const reject = (why: string): ManagedBrowserResult => ({ status: 'rejected', service: 'browser', tool: input.name,
      operationId: input.operationId, reason: why })
    if (run.stopped || input.signal?.aborted) return reject('任务已停止')
    try { await this.ensurePrepared(input.runId, run) }
    catch (cause) { return { status: 'failed', service: 'browser', tool: input.name, operationId: input.operationId, reason: reason(cause) } }
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
    const before = effect === 'write' ? new Set(await fs.readdir(run.scratch!)) : new Set<string>()
    if (run.stopped || input.signal?.aborted || (effect === 'write' || tool === 'browser_navigate') && run.control !== 'agent') return reject('当前操作已停止或用户正在接管；本次动作未执行')
    if (effect === 'write' && input.snapshotId !== run.snapshotId && input.snapshotId !== run.fileChooserSnapshotId) return reject('页面已由用户接管或重新观察，请重新发起动作')
    run.used = true
    const actionApproval = effect === 'write' ? { tool, digest: createHash('sha256').update(JSON.stringify(remoteArgs)).digest('hex') } : undefined
    if (actionApproval) run.pendingApproval = actionApproval
    let result: McpCallResult
    try {
      input.onDispatched?.()
      result = run.embedded
        ? await run.embedded.invoke({ operationId: input.operationId, name: `mcp.browser.${tool}`, arguments: remoteArgs, signal: input.signal })
        : await run.client!.invoke({ runId: input.runId, operationId: input.operationId,
          name: `mcp.browser.${tool}`, arguments: remoteArgs, signal: input.signal })
    } finally { if (run.pendingApproval === actionApproval) run.pendingApproval = undefined }
    if (run.stopped || input.signal?.aborted) return { status: effect === 'write' ? 'unknown' : 'rejected', service: 'browser', tool: input.name,
      operationId: input.operationId, reason: '浏览器操作中断后结果待核对' }
    const observed = this.observedUrl(result)
    if (observed && observed !== 'about:blank' && !this.allowedUrl(run.grant, observed)) {
      await this.stopRun(input.runId)
      return { status: 'failed', service: 'browser', tool: input.name, operationId: input.operationId,
        reason: '浏览器转到了任务未授权的来源，已停止会话' }
    }
    if (observed) run.pageUrl = observed === 'about:blank' ? undefined : observed
    if (result.status === 'returned') {
      if (tool === 'browser_click') run.fileChooserSnapshotId = input.snapshotId
      else if (effect === 'write' || tool === 'browser_navigate') run.fileChooserSnapshotId = undefined
      if (effect === 'write' || tool === 'browser_navigate') run.snapshotId = undefined
      if (tool === 'browser_snapshot') run.snapshotId = randomUUID()
      const { downloads, issues } = await this.collectDownloads(run, before, result)
      return { ...result, ...(run.snapshotId && tool === 'browser_snapshot' ? { snapshotId: run.snapshotId } : {}),
        ...(downloads.length ? { downloads } : {}), ...(issues.length ? { downloadIssues: issues } : {}) }
    }
    return result
  }

  async readResource(runId: string, resourceId: string): Promise<{ mimeType: string; bytes: Uint8Array }> {
    const run = this.run(runId)
    if (run.stopped) throw new Error('任务已停止')
    const download = run.resources.get(resourceId)
    if (!download) {
      await this.ensurePrepared(runId, run)
      return run.embedded ? run.embedded.readResource(resourceId) : run.client!.readResource(runId, resourceId)
    }
    const bytes = await fs.readFile(download.filename)
    if (run.stopped || bytes.length !== download.byteLength) throw new Error('下载成果已停止或发生变化')
    return { mimeType: download.mimeType, bytes }
  }

  lookup(runId: string, operationId: string): Promise<ManagedBrowserResult | null> {
    return this.run(runId).results.get(operationId)?.result ?? Promise.resolve(null)
  }

  async stopRun(runId: string): Promise<void> {
    const run = this.runs.get(runId)
    if (!run || run.stopped) return
    run.stopped = true; run.control = 'stopped'; run.controlGeneration++
    run.activeOperation?.abort(new Error('浏览器任务已停止'))
    for (const notify of [...run.controlWaiters]) notify()
    run.resources.clear()
    // Cancel any in-flight preparation so a failing or slow prepare does not leak.
    if (run.prepared && !run.prepareError) await run.prepared.catch(() => undefined)
    if (run.embedded) await run.embedded.stop()
    if (run.proxy) await run.proxy.stop()
    // Ask the exact task browser to exit before stopping its transport, so its Edge children release their profile.
    if (run.used && run.client) await run.client.invoke({ runId, operationId: `host-close-${randomUUID()}`, name: 'mcp.browser.browser_close', arguments: {} }).catch(() => undefined)
    if (run.client) await run.client.stopRun(runId)
    const root = run.scratch ? await fs.realpath(this.options.scratchRoot).catch(() => undefined) : undefined
    const target = run.scratch ? await fs.realpath(run.scratch).catch(() => undefined) : undefined
    if (root && target && within(root, target) && target !== root && !run.preserveScratch) await fs.rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
  }

  async endRun(runId: string): Promise<void> {
    const run = this.runs.get(runId)
    if (!run) return
    await this.stopRun(runId)
    if (run.client) await run.client.endRun(runId)
    this.runs.delete(runId)
  }
}
