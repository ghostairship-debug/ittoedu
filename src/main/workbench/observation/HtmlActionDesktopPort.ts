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

/** Uses the existing sandboxed preview iframe. No page API gains host privileges. */
export class HtmlActionDesktopPort implements HtmlActionFramePort {
  async frameToken(context: HtmlPreviewAutomationContext): Promise<string> { return frameFor(context).frame.frameToken }

  async observe(context: HtmlPreviewAutomationContext, frameToken: string): Promise<HtmlPageState> {
    const { frame } = frameFor(context, frameToken)
    const observed = await frame.executeJavaScript(htmlActionScript({ type: 'observe' })) as HtmlPageState
    frameFor(context, frameToken)
    if (!observed || !sameHtmlPreviewDocumentUrl(observed.url, context.lease.url) || !Array.isArray(observed.elements))
      throw new Error('HTML 页面观察来源不匹配')
    return observed
  }

  async act(context: HtmlPreviewAutomationContext, frameToken: string,
    input: Extract<HtmlPageOperation, { type: 'click' | 'input' }>): Promise<HtmlPageActionResult> {
    const { frame } = frameFor(context, frameToken)
    const result = await frame.executeJavaScript(htmlActionScript(input), true) as HtmlPageActionResult
    frameFor(context, frameToken)
    if (!result || typeof result.applied !== 'boolean') throw new Error('HTML 操作未返回真实结果')
    // Allow the page's event handler and one paint turn to settle before capture.
    await frame.executeJavaScript('new Promise(resolve => setTimeout(resolve, 80))')
    frameFor(context, frameToken)
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
      if (event.frame?.frameToken !== frameToken || !['warning', 'error'].includes(event.level)) return
      receive({ level: event.level as 'warning' | 'error', message: event.message.slice(0, 1000),
        source: event.sourceId.slice(0, 400), line: event.lineNumber })
    }
    contents.on('console-message', listener)
    return () => { if (!contents.isDestroyed()) contents.off('console-message', listener) }
  }
}
