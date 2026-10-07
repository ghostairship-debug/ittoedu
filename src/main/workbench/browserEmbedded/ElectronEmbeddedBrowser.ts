import { session, WebContentsView, type BrowserWindow, type DownloadItem } from 'electron'
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import type { McpCallResult, McpContent, McpDiscoveredTool } from '../externalTools/McpClientService'
import type { EmbeddedBrowserViewport, EmbeddedBrowserViewportState } from '../../../shared/workbench/embeddedBrowser'
import type { EmbeddedBrowserBackend, EmbeddedBrowserBackendFactory, EmbeddedBrowserBackendOptions, ObservedBrowserAction } from './EmbeddedBrowserBackend'
import type { ManagedBrowserTool } from '../externalTools/ManagedBrowserMcpService'
import { managedBrowserActionFactsCode } from '../externalTools/managedBrowserControlCode'

interface AxNode {
  nodeId: string
  parentId?: string
  ignored?: boolean
  backendDOMNodeId?: number
  role?: { value?: string }
  name?: { value?: string }
  value?: { value?: string | number }
  properties?: { name: string; value: { value?: unknown } }[]
  childIds?: string[]
}
interface PendingDownload { name: string; settled: Promise<void>; done: boolean; announced: boolean; issue?: string; item: DownloadItem }
type DomAddress = { backendNodeId: number } | { nodeId: number }

function schema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false }
}
const string = { type: 'string' }, bool = { type: 'boolean' }
const target = { ...string, description: '最近页面快照的 e 编号；也可使用精确 CSS 选择器。' }
const tools: readonly McpDiscoveredTool[] = [
  { remoteName: 'browser_navigate', effect: 'read', description: '在当前任务页面打开网页。', inputSchema: schema({ url: string }, ['url']) },
  { remoteName: 'browser_snapshot', effect: 'read', description: '观察当前任务网页的可访问结构与元素编号。', inputSchema: schema({ target, depth: { type: 'number' }, boxes: bool }) },
  { remoteName: 'browser_find', effect: 'read', description: '在当前页面可访问结构中查找文本。', inputSchema: schema({ text: string, regex: bool }, ['text']) },
  { remoteName: 'browser_take_screenshot', effect: 'read', description: '截取当前网页或指定元素的图片。', inputSchema: schema({ target, element: string, type: { enum: ['png', 'jpeg'] }, fullPage: bool, scale: { enum: ['css', 'device'] } }) },
  { remoteName: 'browser_wait_for', effect: 'read', description: '等待页面出现或移除文本，也可等待指定时间。', inputSchema: schema({ text: string, textGone: string, time: { type: 'number', minimum: 0 } }) },
  { remoteName: 'browser_click', effect: 'write', description: '点击最近观察中指定的网页元素。', inputSchema: schema({ target, element: string, button: { enum: ['left', 'right', 'middle'] }, doubleClick: bool, modifiers: { type: 'array', items: string } }, ['target']) },
  { remoteName: 'browser_type', effect: 'write', description: '替换指定输入框内容，可按回车提交。', inputSchema: schema({ target, element: string, text: string, submit: bool, slowly: bool }, ['target', 'text']) },
  { remoteName: 'browser_file_upload', effect: 'write', description: '向当前已打开的文件选择框上传授权文件。', inputSchema: schema({ paths: { type: 'array', items: string } }, ['paths']) },
].map(tool => ({ ...tool, name: `mcp.browser.${tool.remoteName}` })) as readonly McpDiscoveredTool[]

/** Electron's actual task WebContents is both the visible page and CDP automation target. */
class ElectronEmbeddedBrowser implements EmbeddedBrowserBackend {
  private readonly view: WebContentsView
  private readonly refs = new Map<string, number>()
  private readonly resources = new Map<string, { mimeType: string; bytes: Uint8Array }>()
  private readonly downloads: PendingDownload[] = []
  private readonly downloadNames = new Set<string>()
  private readonly lifetime = new AbortController()
  private window?: BrowserWindow
  private viewportRequest: EmbeddedBrowserViewport = { visible: false }
  private human = false
  private dispatchingInput = false
  private stopped = false
  private chooser?: DomAddress

  private constructor(private readonly options: EmbeddedBrowserBackendOptions, private readonly getWindow: () => BrowserWindow | null,
    browserSession: Electron.Session) {
    this.view = new WebContentsView({ webPreferences: { session: browserSession, nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false } })
    this.view.setBounds({ x: 0, y: 0, width: 1000, height: 700 })
    this.view.setVisible(false)
    const contents = this.view.webContents
    contents.on('will-navigate', details => {
      if (!options.allowedUrl(details.url)) details.preventDefault()
    })
    contents.setWindowOpenHandler(({ url }) => {
      if (options.allowedUrl(url)) void contents.loadURL(url).catch(() => undefined)
      return { action: 'deny' }
    })
    contents.on('did-navigate', (_event, url) => this.pageChanged(url))
    contents.on('did-navigate-in-page', (_event, url, mainFrame) => { if (mainFrame) this.pageChanged(url) })
    contents.on('before-input-event', event => { if (!this.human && !this.dispatchingInput) event.preventDefault() })
    contents.on('before-mouse-event', event => { if (!this.human && !this.dispatchingInput) event.preventDefault() })
    contents.debugger.on('message', (_event, method, params) => {
      if (method === 'Page.fileChooserOpened' && typeof params.backendNodeId === 'number') this.chooser = { backendNodeId: params.backendNodeId }
    })
    browserSession.on('will-download', (_event, item, source) => {
      if (source?.id !== contents.id) { item.cancel(); return }
      if (this.stopped) { item.cancel(); return }
      const original = basename(item.getFilename()).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'download'
      let name = original
      if (this.downloadNames.has(name)) name = `${randomUUID()}-${original}`
      this.downloadNames.add(name)
      item.setSavePath(join(options.scratch, name))
      let resolve!: () => void
      const pending: PendingDownload = { name, item, done: false, announced: false, settled: new Promise<void>(done => { resolve = done }) }
      this.downloads.push(pending)
      item.once('done', (_event, state) => {
        pending.done = true
        if (state !== 'completed') pending.issue = `下载未完成（${state}）`
        resolve()
      })
    })
  }

  static async create(options: EmbeddedBrowserBackendOptions, getWindow: () => BrowserWindow | null): Promise<ElectronEmbeddedBrowser> {
    // No persist: prefix: browser login state belongs to this task, separate from Provider OAuth and the editor.
    const browserSession = session.fromPartition(`guoling-task-browser-${randomUUID()}`, { cache: false })
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      if (details.url === 'about:blank' || /^(?:data|blob):/.test(details.url)) { callback({}); return }
      // The existing DNS-pinned proxy governs all HTTP(S) egress. Reject filesystem and custom protocols here.
      callback({ cancel: !/^https?:/.test(details.url) })
    })
    await browserSession.setProxy({ mode: 'fixed_servers', proxyRules: options.proxyUrl, proxyBypassRules: '<-loopback>' })
    const browser = new ElectronEmbeddedBrowser(options, getWindow, browserSession)
    try {
      // Electron CDP commands before initial navigation can remain pending; navigate first.
      await browser.view.webContents.loadURL('about:blank')
      browser.view.webContents.debugger.attach('1.3')
      await browser.command('Page.enable')
      await browser.command('DOM.enable')
      await browser.command('Accessibility.enable')
      await browser.command('Page.setInterceptFileChooserDialog', { enabled: true })
      return browser
    } catch (error) { await browser.stop(); throw error }
  }

  private pageChanged(url: string): void {
    this.refs.clear(); this.chooser = undefined
    this.options.onPageChanged(url)
  }

  private assertActive(signal?: AbortSignal): void {
    if (this.stopped || this.view.webContents.isDestroyed() || signal?.aborted) throw new Error('任务浏览器已停止')
  }
  private assertAutomaticInput(signal?: AbortSignal): void {
    this.assertActive(signal)
    if (this.human) throw new Error('当前网页由用户接管，自动输入已停止')
  }
  private command(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<any> {
    this.assertActive(signal)
    if (method.startsWith('Input.') || method === 'DOM.focus' || method === 'DOM.setFileInputFiles') this.assertAutomaticInput(signal)
    return this.untilSettled(this.view.webContents.debugger.sendCommand(method, params), signal)
  }
  private async address(target: unknown, signal?: AbortSignal): Promise<DomAddress> {
    this.assertActive(signal)
    if (typeof target !== 'string' || !target) throw new Error('需要网页元素编号或选择器')
    const ref = this.refs.get(target.replace(/^\[ref=(.*?)\]$/, '$1'))
    if (ref) return { backendNodeId: ref }
    if (/^e\d+$/.test(target)) throw new Error('页面元素编号已失效，请重新观察当前网页')
    const { root } = await this.command('DOM.getDocument', { depth: 0 }, signal)
    const { nodeId } = await this.command('DOM.querySelector', { nodeId: root.nodeId, selector: target }, signal)
    if (!nodeId) throw new Error('当前网页未找到指定元素')
    return { nodeId }
  }
  private async axNodes(signal?: AbortSignal): Promise<AxNode[]> {
    const { nodes } = await this.command('Accessibility.getFullAXTree', {}, signal)
    return nodes as AxNode[]
  }
  private async snapshot(args: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; truncated: boolean }> {
    const nodes = await this.axNodes(signal)
    const byId = new Map(nodes.map(node => [node.nodeId, node]))
    let root = nodes[0], refCount = 0
    if (args.target) {
      const address = await this.address(args.target, signal)
      const { nodes: partial } = await this.command('Accessibility.getPartialAXTree', { ...address, fetchRelatives: false }, signal)
      root = partial[0]
    }
    this.assertActive(signal)
    this.refs.clear()
    const lines = [`- Page URL: ${this.view.webContents.getURL()}`, `- Page Title: ${this.view.webContents.getTitle()}`, '### Page snapshot']
    const maxDepth = typeof args.depth === 'number' && args.depth >= 0 ? args.depth : 100
    const visit = (node: AxNode | undefined, depth: number) => {
      if (!node || depth > maxDepth) return
      const role = node.role?.value ?? 'generic', name = node.name?.value ?? ''
      const protectedValue = node.properties?.some(property => property.name === 'protected' && property.value.value === true)
      if (!node.ignored) {
        const ref = node.backendDOMNodeId ? `e${++refCount}` : undefined
        if (ref) this.refs.set(ref, node.backendDOMNodeId!)
        const value = protectedValue ? '' : node.value?.value
        lines.push(`${'  '.repeat(Math.min(depth, 30))}- ${role}${name ? ` ${JSON.stringify(name)}` : ''}${ref ? ` [ref=${ref}]` : ''}${value !== undefined && value !== '' ? `: ${JSON.stringify(value)}` : ''}`)
      }
      for (const id of node.childIds ?? []) visit(byId.get(id), node.ignored ? depth : depth + 1)
    }
    visit(root, 0)
    const text = lines.join('\n')
    const truncated = text.length > 100_000
    return { text: truncated ? `${text.slice(0, 100_000)}\n[页面快照超过本次输出范围；可指定元素继续观察]` : text, truncated }
  }

  async discover(writeAllowed: boolean): Promise<import('../externalTools/McpClientService').McpDiscovery> {
    this.assertActive()
    return { status: 'available', tools: tools.filter(tool => writeAllowed || tool.effect === 'read') }
  }

  async inspectAction(input: { tool: ManagedBrowserTool; arguments: Record<string, unknown> }): Promise<ObservedBrowserAction> {
    this.assertActive()
    const pageUrl = this.view.webContents.getURL()
    if (input.tool === 'browser_file_upload') return { pageUrl, action: this.chooser ? 'upload' : 'unknown' }
    const address = await this.address(input.arguments.target)
    const { object } = await this.command('DOM.resolveNode', address)
    try {
      const reply = await this.command('Runtime.callFunctionOn', { objectId: object.objectId,
        functionDeclaration: managedBrowserActionFactsCode, returnByValue: true })
      if (reply.exceptionDetails) throw new Error('当前网页动作未能观察')
      const facts = reply.result.value as { tag: string; type: string; editable: boolean; formAction?: string; linkUrl?: string; download: boolean }
      if (input.tool === 'browser_type') {
        if (input.arguments.submit === true) return { pageUrl, action: facts.formAction ? 'submit' : 'unknown',
          ...(facts.formAction ? { destinationUrl: facts.formAction } : {}) }
        return { pageUrl, action: facts.tag === 'input' || facts.tag === 'textarea' || facts.editable ? 'prepare' : 'unknown' }
      }
      if (input.tool !== 'browser_click') return { pageUrl, action: 'unknown' }
      if (facts.linkUrl) {
        if (!/^https?:/.test(facts.linkUrl)) return { pageUrl, action: 'unknown' }
        return { pageUrl, action: facts.download ? 'download' : 'prepare', destinationUrl: facts.linkUrl }
      }
      if (facts.formAction && (facts.type === 'submit' || facts.type === 'image')) return { pageUrl, action: 'submit',
        ...(facts.formAction ? { destinationUrl: facts.formAction } : {}) }
      if (facts.tag === 'input' && !['button', 'reset', 'hidden'].includes(facts.type)
        || ['textarea', 'select', 'summary'].includes(facts.tag) || facts.editable) return { pageUrl, action: 'prepare' }
      return { pageUrl, action: 'unknown' }
    } finally { if (object.objectId) await this.command('Runtime.releaseObject', { objectId: object.objectId }).catch(() => undefined) }
  }

  async invoke(input: { operationId: string; name: string; arguments: Record<string, unknown>; signal?: AbortSignal }): Promise<McpCallResult> {
    const tool = input.name.replace(/^mcp\.browser\./, ''), args = input.arguments
    const content: McpContent[] = []
    let truncated = false
    const beforeDownloads = this.downloads.length
    let dispatched = false
    try {
      this.assertActive(input.signal)
      if (tool === 'browser_navigate') {
        if (typeof args.url !== 'string' || !this.options.allowedUrl(args.url)) throw new Error('网页地址不在本任务授权范围')
        await this.untilSettled(this.view.webContents.loadURL(args.url), input.signal)
      } else if (tool === 'browser_snapshot') {
        const observed = await this.snapshot(args, input.signal)
        content.push({ type: 'text', ...observed }); truncated = observed.truncated
      } else if (tool === 'browser_find') {
        const nodes = await this.axNodes(input.signal)
        const pattern = args.regex ? new RegExp(String(args.text), 'i') : undefined
        const found = nodes.filter(node => !node.ignored && (pattern ? pattern.test(node.name?.value ?? '') : (node.name?.value ?? '').includes(String(args.text))))
        content.push({ type: 'text', text: found.map(node => `${node.role?.value}: ${node.name?.value}`).join('\n') || '未找到匹配文本', truncated: false })
      } else if (tool === 'browser_click') {
        const address = await this.address(args.target, input.signal)
        await this.command('DOM.scrollIntoViewIfNeeded', address, input.signal)
        const { model } = await this.command('DOM.getBoxModel', address, input.signal)
        const quad: number[] = model.content
        const x = (quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4, y = (quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4
        const buttons: Record<string, number> = { left: 1, right: 2, middle: 4 }
        const button = String(args.button ?? 'left'), clickCount = args.doubleClick ? 2 : 1
        const modifierBits: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8, ControlOrMeta: process.platform === 'darwin' ? 4 : 2 }
        const modifiers = Array.isArray(args.modifiers) ? args.modifiers.reduce((value, modifier) => value | (modifierBits[String(modifier)] ?? 0), 0) : 0
        this.dispatchingInput = true
        try {
          this.assertAutomaticInput(input.signal)
          dispatched = true
          await this.command('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: buttons[button], clickCount, modifiers }, input.signal)
          await this.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount, modifiers }, input.signal)
        } finally { this.dispatchingInput = false }
        await this.afterAction(input.signal)
      } else if (tool === 'browser_type') {
        const address = await this.address(args.target, input.signal)
        await this.command('DOM.focus', address, input.signal)
        this.dispatchingInput = true
        try {
          this.assertAutomaticInput(input.signal)
          dispatched = true
          await this.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: process.platform === 'darwin' ? 4 : 2 }, input.signal)
          await this.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: process.platform === 'darwin' ? 4 : 2 }, input.signal)
          if (args.slowly) for (const text of String(args.text)) await this.command('Input.insertText', { text }, input.signal)
          else await this.command('Input.insertText', { text: String(args.text) }, input.signal)
          if (args.submit) {
            await this.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, input.signal)
            await this.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, input.signal)
          }
        } finally { this.dispatchingInput = false }
        await this.afterAction(input.signal)
      } else if (tool === 'browser_file_upload') {
        if (!this.chooser) throw new Error('当前没有待处理的文件选择框，请先点击上传元素')
        dispatched = true
        await this.command('DOM.setFileInputFiles', { ...this.chooser, files: args.paths }, input.signal)
        this.chooser = undefined
        await this.afterAction(input.signal)
      } else if (tool === 'browser_take_screenshot') {
        const format = args.type === 'jpeg' ? 'jpeg' : 'png'
        let clip: Record<string, unknown> | undefined
        if (args.target) {
          const { model } = await this.command('DOM.getBoxModel', await this.address(args.target, input.signal), input.signal)
          const xs = [model.border[0], model.border[2], model.border[4], model.border[6]], ys = [model.border[1], model.border[3], model.border[5], model.border[7]]
          clip = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), scale: 1 }
        } else if (args.fullPage) {
          const { cssContentSize } = await this.command('Page.getLayoutMetrics', {}, input.signal)
          clip = { ...cssContentSize, scale: 1 }
        }
        const { data } = await this.command('Page.captureScreenshot', { format, ...(clip ? { clip } : {}), captureBeyondViewport: args.fullPage === true || !!clip }, input.signal)
        const bytes = Buffer.from(data, 'base64'), resourceId = randomUUID(), mimeType = `image/${format}`
        this.resources.set(resourceId, { mimeType, bytes })
        content.push({ type: 'binary', resourceId, mimeType, byteLength: bytes.byteLength })
      } else if (tool === 'browser_wait_for') {
        if (typeof args.time === 'number') await this.wait(args.time * 1000, input.signal)
        if (args.text || args.textGone) {
          for (;;) {
            this.assertActive(input.signal)
            const nodes = await this.axNodes(input.signal), text = nodes.map(node => node.name?.value ?? '').join('\n')
            if ((!args.text || text.includes(String(args.text))) && (!args.textGone || !text.includes(String(args.textGone)))) break
            await this.wait(100, input.signal)
          }
        }
      } else throw new Error('浏览器工具不受支持')
      this.assertActive(input.signal)
      if (tool !== 'browser_snapshot') content.push({ type: 'text', text: `- Page URL: ${this.view.webContents.getURL()}\n- Page Title: ${this.view.webContents.getTitle()}`, truncated: false })
      for (const download of this.downloads.filter(download => !download.announced)) {
        if (!download.done && this.downloads.indexOf(download) >= beforeDownloads) {
          await this.untilSettled(download.settled, input.signal)
        }
        if (!download.done && this.downloads.indexOf(download) < beforeDownloads) continue
        this.assertActive(input.signal)
        download.announced = true
        if (download.issue) content.push({ type: 'text', text: `${download.name}: ${download.issue}`, truncated: false })
        else content.push({ type: 'text', text: `- Downloaded file ${download.name} to "${download.name}"`, truncated: false })
      }
      return { status: 'returned', service: 'browser', tool: input.name, operationId: input.operationId, content, truncated }
    } catch (error) {
      return { status: dispatched ? 'unknown' : 'failed', service: 'browser', tool: input.name, operationId: input.operationId,
        reason: error instanceof Error ? error.message.slice(0, 300) : '任务浏览器未返回可核查结果' }
    }
  }

  private async afterAction(signal?: AbortSignal): Promise<void> {
    await this.wait(100, signal)
    while (this.view.webContents.isLoading()) {
      this.assertActive(signal)
      await this.wait(50, signal)
    }
  }
  private untilSettled<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
    this.assertActive(signal)
    return new Promise((resolve, reject) => {
      const cleanup = () => { signal?.removeEventListener('abort', abort); this.lifetime.signal.removeEventListener('abort', abort) }
      const abort = () => { cleanup(); reject(new Error('任务浏览器已停止')) }
      signal?.addEventListener('abort', abort, { once: true })
      this.lifetime.signal.addEventListener('abort', abort, { once: true })
      pending.then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
    })
  }
  private wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
    this.assertActive(signal)
    return new Promise((resolve, reject) => {
      const cleanup = () => { signal?.removeEventListener('abort', abort); this.lifetime.signal.removeEventListener('abort', abort) }
      const abort = () => { clearTimeout(timer); cleanup(); reject(new Error('任务浏览器已停止')) }
      const timer = setTimeout(() => { cleanup(); resolve() }, milliseconds)
      signal?.addEventListener('abort', abort, { once: true })
      this.lifetime.signal.addEventListener('abort', abort, { once: true })
    })
  }

  async control(human: boolean): Promise<void> {
    this.assertActive()
    if (human && !this.viewportRequest.visible) throw new Error('请先在工作台显示当前任务网页，再接管操作')
    this.human = human
    this.refs.clear(); this.chooser = undefined
    if (human) { this.window?.show(); this.window?.focus(); this.view.webContents.focus() }
    else this.window?.webContents.focus()
  }

  viewport(input: EmbeddedBrowserViewport): EmbeddedBrowserViewportState {
    this.assertActive()
    const nextWindow = this.getWindow()
    if (input.visible && (!nextWindow || nextWindow.isDestroyed())) throw new Error('当前没有可用工作台窗口')
    if (nextWindow !== this.window) {
      if (this.window && !this.window.isDestroyed()) this.window.contentView.removeChildView(this.view)
      this.window = nextWindow ?? undefined
      this.window?.contentView.addChildView(this.view)
    }
    const factor = this.window?.webContents.getZoomFactor() ?? 1
    const bounds = input.bounds
    if (bounds) {
      if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width < 1 || bounds.height < 1) throw new Error('任务网页显示范围无效')
      const [width, height] = this.window?.getContentSize() ?? [0, 0]
      const x = Math.max(0, Math.round(bounds.x * factor)), y = Math.max(0, Math.round(bounds.y * factor))
      this.view.setBounds({ x, y, width: Math.max(1, Math.min(Math.round(bounds.width * factor), width - x)),
        height: Math.max(1, Math.min(Math.round(bounds.height * factor), height - y)) })
    }
    this.viewportRequest = { ...input }
    this.view.setVisible(input.visible)
    const pageUrl = this.view.webContents.getURL()
    return { embedded: true, visible: input.visible, ...(pageUrl && pageUrl !== 'about:blank' ? { pageUrl } : {}) }
  }

  async readResource(resourceId: string): Promise<{ mimeType: string; bytes: Uint8Array }> {
    this.assertActive()
    const resource = this.resources.get(resourceId)
    if (!resource) throw new Error('任务浏览器图片资源不存在')
    return resource
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.lifetime.abort()
    for (const download of this.downloads) if (!download.done) download.item.cancel()
    if (this.window && !this.window.isDestroyed()) this.window.contentView.removeChildView(this.view)
    const contents = this.view.webContents
    if (!contents.isDestroyed()) {
      if (contents.debugger.isAttached()) contents.debugger.detach()
      const browserSession = contents.session
      contents.close()
      await browserSession.clearStorageData()
    }
    this.resources.clear(); this.refs.clear()
  }
}

export function createElectronEmbeddedBrowserFactory(getWindow: () => BrowserWindow | null): EmbeddedBrowserBackendFactory {
  return options => ElectronEmbeddedBrowser.create(options, getWindow)
}
