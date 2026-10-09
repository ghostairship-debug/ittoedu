import { webContents, type WebContents, type WebFrameMain } from 'electron'
import type { HtmlPreviewAutomationContext } from '../htmlPreview/HtmlPreviewService'
import { htmlActionScript, sameHtmlPreviewDocumentUrl,
  type HtmlPageActionResult, type HtmlPageOperation, type HtmlPageState } from './HtmlActionPageScript'

export interface HtmlActionCapture { png: Uint8Array; width: number; height: number }
export interface HtmlActionDiagnostic { level: 'error' | 'warning'; message: string; source: string; line: number }

export interface HtmlActionFramePort {
  frameToken(context: HtmlPreviewAutomationContext): Promise<string>
  observe(context: HtmlPreviewAutomationContext, frameToken: string): Promise<HtmlPageState>
  act(context: HtmlPreviewAutomationContext, frameToken: string, input: Extract<HtmlPageOperation, { type: 'click' | 'input' }>): Promise<HtmlPageActionResult>
  navigate(context: HtmlPreviewAutomationContext, frameToken: string, index: number): Promise<void>
  capture(context: HtmlPreviewAutomationContext, frameToken: string): Promise<HtmlActionCapture>
  onDiagnostic(context: HtmlPreviewAutomationContext, frameToken: string, receive: (diagnostic: HtmlActionDiagnostic) => void): () => void
}

function contentsFor(context: HtmlPreviewAutomationContext): WebContents {
  const contents = webContents.fromId(context.webContentsId)
  if (!contents || contents.isDestroyed() || contents.mainFrame.detached)
    throw new Error('HTML 预览载体已关闭')
  return contents
}

function frameFor(context: HtmlPreviewAutomationContext, frameToken?: string): { contents: WebContents; frame: WebFrameMain } {
  const contents = contentsFor(context)
  const frames = contents.mainFrame.framesInSubtree.filter(frame => frame.parent?.frameToken === contents.mainFrame.frameToken
    && frame.parent.processId === contents.mainFrame.processId && !frame.detached && !frame.isDestroyed()
    && sameHtmlPreviewDocumentUrl(frame.url, context.lease.url))
  if (frames.length !== 1 || (frameToken && frames[0]!.frameToken !== frameToken))
    throw new Error('HTML 页面已重新加载或切换，请重新开始观察')
  return { contents, frame: frames[0]! }
}

function iframeScript(url: string, operation: 'rect' | 'navigate', loadId?: string, index?: number): string {
  return `(() => { const frames = Array.from(document.querySelectorAll('iframe')).filter(frame => frame.src === ${JSON.stringify(url)});
    if (frames.length !== 1 || !frames[0].contentWindow) return null;
    const frame = frames[0];
    ${operation === 'navigate'
      ? `frame.contentWindow.postMessage({ type: 'html-preview.navigate', loadId: ${JSON.stringify(loadId)}, index: ${JSON.stringify(index)} }, '*'); return true;`
      : `const rect = frame.getBoundingClientRect(); const style = getComputedStyle(frame);
         if (style.display === 'none' || style.visibility === 'hidden') return null;
         return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
           viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };`}
  })()`
}

/** Consume the same live readiness used by formal capture, before reading DOM and screenshot together. */
export function htmlObservationReadyScript(): string {
  return `(async()=>{
    let deadline;const timeout=new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('HTML 运行内容尚未就绪')),15000)});
    try{await Promise.race([timeout,(async()=>{
      const player=window.coursePlayerReady ? await window.coursePlayerReady : window.coursePlayer;
      if(player?.waitForCaptureReady) await player.waitForCaptureReady();
      await document.fonts?.ready;
      await Promise.all(Array.from(document.images).filter(image=>image.getBoundingClientRect().width>0).map(image=>image.decode().catch(()=>{})));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    })()]);}finally{clearTimeout(deadline)}
  })()`
}

function visibleChildFramesScript(): string {
  return `(()=>{const frames=[];const visit=root=>{for(const node of root.querySelectorAll('*')){
    if(node.shadowRoot)visit(node.shadowRoot);
    if(node.localName==='iframe'){const rect=node.getBoundingClientRect();const style=getComputedStyle(node);
      frames.push({name:node.name,url:node.hasAttribute('srcdoc')?'about:srcdoc':node.src||'about:blank',
        visible:rect.width>0&&rect.height>0&&style.visibility!=='hidden'&&style.display!=='none'});
    }
  }};visit(document);return frames})()`
}

/** Only current visible descendants of this document's exact preview frame can supply handles. */
async function visibleChildFrames(root: WebFrameMain): Promise<WebFrameMain[]> {
  const result: WebFrameMain[] = []
  const visit = async (parent: WebFrameMain) => {
    const elements = await parent.executeJavaScript(visibleChildFramesScript()) as { name: string; url: string; visible: boolean }[]
    for (const child of parent.frames) {
      if (child.detached || child.isDestroyed()) continue
      const named = child.name && elements.filter(element => element.name === child.name)
      const matches = named && named.length === 1 ? named : elements.filter(element => element.url === child.url)
      const siblings = parent.frames.filter(frame => named && named.length === 1 ? frame.name === child.name : frame.url === child.url)
      if (matches.length !== 1 || siblings.length !== 1 || !matches[0]!.visible) continue
      result.push(child); await visit(child)
    }
  }
  await visit(root)
  return result
}

/** Uses the existing sandboxed preview iframe. No page API gains host privileges. */
export class HtmlActionDesktopPort implements HtmlActionFramePort {
  async frameToken(context: HtmlPreviewAutomationContext): Promise<string> { return frameFor(context).frame.frameToken }

  async observe(context: HtmlPreviewAutomationContext, frameToken: string): Promise<HtmlPageState> {
    const { frame } = frameFor(context, frameToken)
    await frame.executeJavaScript(htmlObservationReadyScript())
    frameFor(context, frameToken)
    const observed = await frame.executeJavaScript(htmlActionScript({ type: 'observe' })) as HtmlPageState
    for (const child of await visibleChildFrames(frame)) {
      const state = await child.executeJavaScript(htmlActionScript({ type: 'observe' })) as HtmlPageState
      observed.structure.push(...state.structure)
      observed.diagnostics.push(...state.diagnostics)
      observed.elements.push(...state.elements.map(element => ({ ...element, frameToken: child.frameToken })))
    }
    frameFor(context, frameToken)
    if (!observed || !sameHtmlPreviewDocumentUrl(observed.url, context.lease.url) || !Array.isArray(observed.elements))
      throw new Error('HTML 页面观察来源不匹配')
    return observed
  }

  async act(context: HtmlPreviewAutomationContext, frameToken: string,
    input: Extract<HtmlPageOperation, { type: 'click' | 'input' }>): Promise<HtmlPageActionResult> {
    const { frame } = frameFor(context, frameToken)
    const targetFrame = input.frameToken ? (await visibleChildFrames(frame)).find(child => child.frameToken === input.frameToken) : frame
    if (!targetFrame) return { applied: false, reason: 'stale-element' }
    const result = await targetFrame.executeJavaScript(htmlActionScript(input), true) as HtmlPageActionResult
    frameFor(context, frameToken)
    if (!result || typeof result.applied !== 'boolean') throw new Error('HTML 操作未返回真实结果')
    return result
  }

  async navigate(context: HtmlPreviewAutomationContext, frameToken: string, index: number): Promise<void> {
    const { contents } = frameFor(context, frameToken)
    const posted = await contents.mainFrame.executeJavaScript(iframeScript(context.lease.url, 'navigate', context.lease.loadId, index))
    if (posted !== true) throw new Error('HTML 预览框架当前不可见或来源已变化')
    await new Promise(resolve => setTimeout(resolve, 80))
    frameFor(context, frameToken)
  }

  async capture(context: HtmlPreviewAutomationContext, frameToken: string): Promise<HtmlActionCapture> {
    const { contents } = frameFor(context, frameToken)
    const rect = await contents.mainFrame.executeJavaScript(iframeScript(context.lease.url, 'rect')) as {
      x: number; y: number; width: number; height: number; viewportWidth: number; viewportHeight: number
    } | null
    if (!rect) throw new Error('HTML 预览不可见，请打开该文档的预览')
    const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y))
    const width = Math.min(2048, Math.ceil(Math.min(rect.x + rect.width, rect.viewportWidth) - x))
    const height = Math.min(2048, Math.ceil(Math.min(rect.y + rect.height, rect.viewportHeight) - y))
    if (width < 8 || height < 8) throw new Error('HTML 预览没有可见画面')
    const bitmap = await contents.capturePage({ x, y, width, height })
    frameFor(context, frameToken)
    const size = bitmap.getSize()
    if (bitmap.isEmpty() || size.width < 8 || size.height < 8) throw new Error('HTML 预览没有生成真实截图')
    return { png: new Uint8Array(bitmap.toPNG()), width: size.width, height: size.height }
  }

  onDiagnostic(context: HtmlPreviewAutomationContext, frameToken: string,
    receive: (diagnostic: HtmlActionDiagnostic) => void): () => void {
    const contents = contentsFor(context)
    const listener = (event: Electron.Event<Electron.WebContentsConsoleMessageEventParams>) => {
      if (!['warning', 'error'].includes(event.level)) return
      let source: WebFrameMain | null | undefined = event.frame
      while (source && source.frameToken !== frameToken) source = source.parent
      if (!source) return
      receive({ level: event.level as 'warning' | 'error', message: event.message.slice(0, 1000),
        source: event.sourceId.slice(0, 400), line: event.lineNumber })
    }
    contents.on('console-message', listener)
    return () => { if (!contents.isDestroyed()) contents.off('console-message', listener) }
  }
}
