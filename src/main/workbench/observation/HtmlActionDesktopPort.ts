import { randomUUID } from 'node:crypto'
import { webContents, type WebContents, type WebFrameMain } from 'electron'
import type { HtmlPreviewAutomationContext } from '../htmlPreview/HtmlPreviewService'
import type { ViewObservationIdentity } from '../../../shared/workbench/viewObservation'
import { htmlActionScript, htmlCourseNavigateScript, sameHtmlPreviewDocumentUrl,
  type HtmlFrameObservationScope, type HtmlPageActionResult, type HtmlPageOperation, type HtmlPageState } from './HtmlActionPageScript'
import { waitForCaptureFramePaint } from './captureFramePaint'

export interface HtmlActionCapture { png: Uint8Array; width: number; height: number }
export interface HtmlActionDiagnostic { level: 'error' | 'warning'; message: string; source: string; line: number }
/** Main-owned Published runtime target; no file binding or HTML preview lease is invented. */
export interface PublishedActionAutomationContext {
  kind: 'published'
  runId: string
  identity: ViewObservationIdentity & { projectId: string }
  webContentsId: number
  frameProcessId: number
  frameToken: string
  url: string
}
export type PageActionAutomationContext = HtmlPreviewAutomationContext | PublishedActionAutomationContext
export const isPublishedActionContext = (context: PageActionAutomationContext): context is PublishedActionAutomationContext =>
  'kind' in context && context.kind === 'published'

export interface HtmlActionFramePort {
  frameToken(context: PageActionAutomationContext): Promise<string>
  observe(context: PageActionAutomationContext, frameToken: string): Promise<HtmlPageState>
  /** A single invocation owns readiness, DOM sampling and the immediately following pixels. */
  observeAndCapture?(context: PageActionAutomationContext, frameToken: string, signal?: AbortSignal): Promise<{ state: HtmlPageState; capture: HtmlActionCapture }>
  act(context: PageActionAutomationContext, frameToken: string, input: Extract<HtmlPageOperation, { type: 'click' | 'input' }>, isCurrent?: () => boolean): Promise<HtmlPageActionResult>
  navigate(context: PageActionAutomationContext, frameToken: string, index: number): Promise<void>
  capture(context: PageActionAutomationContext, frameToken: string): Promise<HtmlActionCapture>
  onDiagnostic(context: PageActionAutomationContext, frameToken: string, receive: (diagnostic: HtmlActionDiagnostic) => void): () => void
}

function contentsFor(context: PageActionAutomationContext): WebContents {
  const contents = webContents.fromId(context.webContentsId)
  if (!contents || contents.isDestroyed() || contents.mainFrame.detached)
    throw new Error('HTML 预览载体已关闭')
  return contents
}

function frameFor(context: PageActionAutomationContext, frameToken?: string): { contents: WebContents; frame: WebFrameMain } {
  const contents = contentsFor(context)
  if (isPublishedActionContext(context)) {
    const frame = contents.mainFrame
    if (frame.processId !== context.frameProcessId || frame.frameToken !== context.frameToken
      || frameToken && frameToken !== frame.frameToken || !sameHtmlPreviewDocumentUrl(frame.url, context.url))
      throw new Error('课件观察载体已重新加载或切换，请重新观察')
    return { contents, frame }
  }
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

interface FrameGeometry {
  x: number; y: number; scaleX: number; scaleY: number
  clip: { x: number; y: number; width: number; height: number }
  visible: boolean
  viewportWidth: number; viewportHeight: number
  reason?: string
}
interface VisibleFrame { frame: WebFrameMain; chain: FrameGeometry[] }

async function actionRootGeometry(frame: WebFrameMain): Promise<FrameGeometry | null> {
  if (frame.parent) return ownerGeometry(frame)
  const viewport = await frame.executeJavaScript('({width:innerWidth,height:innerHeight})') as { width: number; height: number }
  return { x: 0, y: 0, scaleX: 1, scaleY: 1, clip: { x: 0, y: 0, ...viewport }, visible: viewport.width > 0 && viewport.height > 0,
    viewportWidth: viewport.width, viewportHeight: viewport.height }
}

/** event.source identifies the actual owner, including repeated anonymous srcdoc/opaque frames. */
async function ownerGeometry(child: WebFrameMain, point?: { x: number; y: number }): Promise<FrameGeometry | null> {
  const parent = child.parent
  if (!parent || child.detached || parent.detached) return null
  const key = `__htmlOwner_${randomUUID().replaceAll('-', '')}`
  await parent.executeJavaScript(`(()=>{
    const key=${JSON.stringify(key)};
    window[key]=new Promise(resolve=>{
      const finish=value=>{clearTimeout(timer);removeEventListener('message',receive);resolve(value)};
      const timer=setTimeout(()=>finish(null),1500);
      const receive=event=>{
        if(event.data!==key)return;
        const frames=[];const visit=root=>{for(const element of root.querySelectorAll('*')){
          if(element.shadowRoot)visit(element.shadowRoot);
          if(element.localName==='iframe'&&element.contentWindow===event.source)frames.push(element);
        }};visit(document);
        if(frames.length!==1)return;
        const owner=frames[0],rect=owner.getBoundingClientRect();
        let left=Math.max(0,rect.left),top=Math.max(0,rect.top),right=Math.min(innerWidth,rect.right),bottom=Math.min(innerHeight,rect.bottom);
        let reason;
        if(getComputedStyle(owner).clipPath==='polygon(0px 0px, 0px 0px, 0px 0px)')reason='empty-paint';
        for(let node=owner;node;node=node.parentElement){
          const style=getComputedStyle(node),matrix=new DOMMatrixReadOnly(style.transform);
          if(style.display==='none'||style.visibility==='hidden')reason='not-visible';
          if(!matrix.is2D||Math.abs(matrix.b)>0.00001||Math.abs(matrix.c)>0.00001||matrix.a<=0||matrix.d<=0)reason='unsupported-frame-transform';
          if(node===owner)continue;
          const clip=node.getBoundingClientRect();
          if(/(hidden|clip|scroll|auto)/.test(style.overflowX)){left=Math.max(left,clip.left);right=Math.min(right,clip.right)}
          if(/(hidden|clip|scroll|auto)/.test(style.overflowY)){top=Math.max(top,clip.top);bottom=Math.min(bottom,clip.bottom)}
        }
        const scaleX=rect.width/owner.offsetWidth,scaleY=rect.height/owner.offsetHeight;
        const ownStyle=getComputedStyle(owner),paddingLeft=parseFloat(ownStyle.paddingLeft)||0,paddingRight=parseFloat(ownStyle.paddingRight)||0;
        const paddingTop=parseFloat(ownStyle.paddingTop)||0,paddingBottom=parseFloat(ownStyle.paddingBottom)||0;
        const x=rect.left+(owner.clientLeft+paddingLeft)*scaleX,y=rect.top+(owner.clientTop+paddingTop)*scaleY;
        left=Math.max(left,x);top=Math.max(top,y);right=Math.min(right,x+(owner.clientWidth-paddingLeft-paddingRight)*scaleX);bottom=Math.min(bottom,y+(owner.clientHeight-paddingTop-paddingBottom)*scaleY);
        const point=${JSON.stringify(point ?? null)};
        if(point){const px=x+point.x*scaleX,py=y+point.y*scaleY;
          let hit=document.elementFromPoint(px,py);while(hit?.shadowRoot){const nested=hit.shadowRoot.elementFromPoint(px,py);if(!nested||nested===hit)break;hit=nested}
          if(px<left||py<top||px>=right||py>=bottom||hit!==owner)reason='covered-frame';
        }
        finish({x,y,scaleX,scaleY,viewportWidth:owner.clientWidth-paddingLeft-paddingRight,viewportHeight:owner.clientHeight-paddingTop-paddingBottom,
          clip:{x:left,y:top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)},
          visible:!reason&&right>left&&bottom>top&&scaleX>0&&scaleY>0,...(reason?{reason}:{})});
      };addEventListener('message',receive);
    });return true;
  })()`)
  try {
    await child.executeJavaScript(`parent.postMessage(${JSON.stringify(key)},'*')`)
    return await parent.executeJavaScript(`window[${JSON.stringify(key)}]`) as FrameGeometry | null
  } finally { if (!parent.detached && !parent.isDestroyed()) await parent.executeJavaScript(`delete window[${JSON.stringify(key)}]`).catch(() => undefined) }
}

function mapRect(rect: { x: number; y: number; width: number; height: number }, chain: FrameGeometry[]) {
  for (const geometry of chain) {
    const x = Math.max(geometry.clip.x, geometry.x + rect.x * geometry.scaleX)
    const y = Math.max(geometry.clip.y, geometry.y + rect.y * geometry.scaleY)
    const right = Math.min(geometry.clip.x + geometry.clip.width, geometry.x + (rect.x + rect.width) * geometry.scaleX)
    const bottom = Math.min(geometry.clip.y + geometry.clip.height, geometry.y + (rect.y + rect.height) * geometry.scaleY)
    rect = { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
  }
  return rect
}

function visibleLocalRect(entry: VisibleFrame) {
  const first = entry.chain[0]!
  const rect = mapRect({ x: 0, y: 0, width: first.viewportWidth, height: first.viewportHeight }, entry.chain)
  for (const geometry of [...entry.chain].reverse()) {
    rect.x = (rect.x - geometry.x) / geometry.scaleX; rect.y = (rect.y - geometry.y) / geometry.scaleY
    rect.width /= geometry.scaleX; rect.height /= geometry.scaleY
  }
  return rect
}

async function visibleChildFrames(root: WebFrameMain, rootClip?: { x: number; y: number; width: number; height: number }): Promise<{ visible: VisibleFrame[]; excluded: Array<{ frame: WebFrameMain; reason: string }> }> {
  const visible: VisibleFrame[] = [], excluded: Array<{ frame: WebFrameMain; reason: string }> = []
  const visit = async (parent: WebFrameMain, chain: FrameGeometry[]) => {
    const children = parent.frames.filter(child => !child.detached && !child.isDestroyed())
    const sampled = await Promise.all(children.map(async child => {
      let geometry: FrameGeometry | null = null
      try { geometry = await ownerGeometry(child) } catch { /* Report inaccessible frames below. */ }
      return { child, geometry }
    }))
    // Sibling geometry reads are independent. Keep the original tree order for
    // clipping, diagnostics and depth-first recursion after those reads settle.
    for (const { child, geometry } of sampled) {
      if (child.detached || child.isDestroyed()) continue
      if (!geometry?.visible) {
        excluded.push({ frame: child, reason: geometry?.reason ?? (geometry ? 'not-visible' : 'owner-unavailable') }); continue
      }
      const next = [geometry, ...chain]
      const clip = visibleLocalRect({ frame: child, chain: next })
      if (clip.width <= 0 || clip.height <= 0) { excluded.push({ frame: child, reason: 'not-visible' }); continue }
      visible.push({ frame: child, chain: next }); await visit(child, next)
    }
  }
  await visit(root, rootClip ? [{ x: 0, y: 0, scaleX: 1, scaleY: 1, clip: rootClip, visible: true,
    viewportWidth: rootClip.width, viewportHeight: rootClip.height }] : [])
  return { visible, excluded }
}

/** DOM sampling and bitmap capture consume the same completed visible frame tree. */
async function prepareVisibleFramePaint(contents: WebContents, frame: WebFrameMain): Promise<void> {
  const descendants = await visibleChildFrames(frame)
  await waitForCaptureFramePaint(contents.mainFrame, randomUUID(),
    [...new Set([contents.mainFrame, frame, ...descendants.visible.map(entry => entry.frame)])])
}

/** Uses the existing sandboxed preview iframe. No page API gains host privileges. */
export class HtmlActionDesktopPort implements HtmlActionFramePort {
  async frameToken(context: PageActionAutomationContext): Promise<string> { return frameFor(context).frame.frameToken }

  async observeAndCapture(context: PageActionAutomationContext, frameToken: string, signal?: AbortSignal): Promise<{ state: HtmlPageState; capture: HtmlActionCapture }> {
    if (signal?.aborted) throw new Error('页面观察已停止')
    const state = await this.observe(context, frameToken)
    if (signal?.aborted) throw new Error('页面观察已停止')
    // observe already completed frame readiness and paint immediately before
    // its read-only DOM sample. Do not rediscover and repaint that tree again.
    const capture = await this.captureReady(context, frameToken)
    if (signal?.aborted) throw new Error('页面观察已停止')
    return { state, capture }
  }

  async observe(context: PageActionAutomationContext, frameToken: string): Promise<HtmlPageState> {
    const { contents, frame } = frameFor(context, frameToken)
    await frame.executeJavaScript(htmlObservationReadyScript())
    frameFor(context, frameToken)
    await prepareVisibleFramePaint(contents, frame)
    frameFor(context, frameToken)
    const geometry = await actionRootGeometry(frame)
    if (!geometry?.visible) throw new Error('HTML 预览当前没有可见画面')
    const rootClip = visibleLocalRect({ frame, chain: [geometry] })
    const observed = await frame.executeJavaScript(htmlActionScript({ type: 'observe', clip: rootClip })) as HtmlPageState
    const scope = observed.observationScope = { kind: 'visible-preview-frames' as const,
      coordinateSpace: 'preview-viewport-css-pixels' as const, viewport: observed.viewport,
      limitations: ['按当前几何可见 frame 与视口内元素观察；遮挡在动作前另做命中检查，隐藏或不可达 frame 的后代未遍历', '捕获全部可见候选；HTML 详情按当前 generation 的可续读窗口返回',
        '诊断覆盖页面加载状态和每个 frame 的前 24 张图片；运行日志仅保留最近 32 条 warning/error'],
      frames: [{ frameId: frame.frameTreeNodeId,
      url: frame.url, status: 'observed' as const, matchedElements: observed.matchedElements ?? observed.elements.length,
      returnedElements: observed.elements.length, truncatedElements: Math.max(0, (observed.matchedElements ?? observed.elements.length) - observed.elements.length) }] as HtmlFrameObservationScope[] }
    const descendants = await visibleChildFrames(frame, rootClip)
    const samples = await Promise.all(descendants.visible.map(async entry => {
      const child = entry.frame
      try {
        const state = await child.executeJavaScript(htmlActionScript({ type: 'observe', clip: visibleLocalRect(entry) })) as HtmlPageState
        const elements = state.elements.map(element => ({ ...element, frameToken: child.frameToken, frameProcessId: child.processId, rect: mapRect(element.rect, entry.chain) }))
          .filter(element => element.rect.width > 0 && element.rect.height > 0)
        return { state, elements, scope: { frameId: child.frameTreeNodeId, url: child.url, status: 'observed' as const,
          matchedElements: state.matchedElements ?? state.elements.length, returnedElements: elements.length,
          truncatedElements: Math.max(0, (state.matchedElements ?? state.elements.length) - state.elements.length) } }
      } catch (error) {
        return { scope: { frameId: child.frameTreeNodeId, url: child.url, status: 'unavailable' as const, matchedElements: 0,
          returnedElements: 0, truncatedElements: 0, reason: error instanceof Error ? error.message : String(error) } }
      }
    }))
    // Merge in the original frame order regardless of IPC completion order.
    for (const sample of samples) {
      if (sample.state) {
        observed.structure.push(...sample.state.structure)
        observed.diagnostics.push(...sample.state.diagnostics)
        observed.elements.push(...sample.elements)
      }
      scope.frames.push(sample.scope)
    }
    for (const entry of descendants.excluded) scope.frames.push({ frameId: entry.frame.frameTreeNodeId, url: entry.frame.url,
      status: ['not-visible', 'empty-paint'].includes(entry.reason) ? 'not-visible' : 'unavailable', matchedElements: 0,
      returnedElements: 0, truncatedElements: 0, reason: entry.reason })
    frameFor(context, frameToken)
    if (!observed || !sameHtmlPreviewDocumentUrl(observed.url, isPublishedActionContext(context) ? context.url : context.lease.url) || !Array.isArray(observed.elements))
      throw new Error('HTML 页面观察来源不匹配')
    return observed
  }

  async act(context: PageActionAutomationContext, frameToken: string,
    input: Extract<HtmlPageOperation, { type: 'click' | 'input' }>, isCurrent = () => true): Promise<HtmlPageActionResult> {
    const { contents, frame } = frameFor(context, frameToken)
    const descendants = input.frameToken ? await visibleChildFrames(frame) : null
    const entry = input.frameToken ? descendants!.visible.find(child => child.frame.frameToken === input.frameToken && child.frame.processId === input.frameProcessId) : { frame, chain: [] }
    if (!entry) return { applied: false, reason: 'stale-element' }
    const prepared = await entry.frame.executeJavaScript(htmlActionScript(input)) as HtmlPageActionResult
    if (!prepared?.applied || !prepared.rect) return prepared
    const rootGeometry = await actionRootGeometry(frame)
    if (!rootGeometry?.visible) return { applied: false, reason: rootGeometry?.reason ?? 'not-visible' }
    const chain = [...entry.chain, rootGeometry]
    const rect = mapRect(prepared.rect, chain)
    if (rect.width <= 0 || rect.height <= 0) return { applied: false, reason: 'not-visible' }
    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    const localPoint = { ...point }
    for (const geometry of [...chain].reverse()) { localPoint.x = (localPoint.x - geometry.x) / geometry.scaleX; localPoint.y = (localPoint.y - geometry.y) / geometry.scaleY }
    const checked = await entry.frame.executeJavaScript(htmlActionScript({ ...input, point: localPoint })) as HtmlPageActionResult
    if (!checked?.applied) return checked
    let currentFrame = entry.frame, currentPoint = localPoint
    while (currentFrame.parent) {
      const geometry = await ownerGeometry(currentFrame, currentPoint)
      if (!geometry?.visible) return { applied: false, reason: geometry?.reason ?? 'not-visible' }
      currentPoint = { x: geometry.x + currentPoint.x * geometry.scaleX, y: geometry.y + currentPoint.y * geometry.scaleY }
      currentFrame = currentFrame.parent
    }
    frameFor(context, frameToken)
    if (!isCurrent()) throw new Error('HTML 观察已停止')
    const attachedHere = !contents.debugger.isAttached()
    if (attachedHere) contents.debugger.attach('1.3')
    const command = async (method: string, parameters: Record<string, unknown>) => {
      if (!isCurrent()) throw new Error('HTML 观察已停止')
      return contents.debugger.sendCommand(method, parameters)
    }
    const checkInput = async (requireFocus = true) => {
      if (input.type !== 'input') throw new Error('HTML 输入类型不匹配')
      if (!isCurrent()) throw new Error('HTML 观察已停止')
      const focused = contents.focusedFrame
      const target = await entry.frame.executeJavaScript(htmlActionScript({ ...input, point: localPoint, requireFocus,
        expectedIdentity: prepared.identityFingerprint })) as HtmlPageActionResult
      if ((requireFocus && (focused?.processId !== entry.frame.processId || focused.frameToken !== entry.frame.frameToken)) || !target.applied)
        throw new Error('真实输入目标或焦点已变化，未继续发送文字')
      return target
    }
    const key = async (name: string, code: number, modifiers = 0) => {
      if (input.type === 'input') await checkInput()
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: name, windowsVirtualKeyCode: code, modifiers })
      // Always release an issued key, including a concurrent Stop.
      await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: name, windowsVirtualKeyCode: code, modifiers })
    }
    try {
      let inputOutcome: HtmlPageActionResult['inputOutcome']
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: currentPoint.x, y: currentPoint.y })
      await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: currentPoint.x, y: currentPoint.y, button: 'left', clickCount: 1 })
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: currentPoint.x, y: currentPoint.y, button: 'left', clickCount: 1 })
      if (input.type === 'input') {
        await checkInput()
        if (checked.selectIndex !== undefined) {
          await key('Home', 36)
          for (let index = 0; index < checked.selectIndex; index++) await key('ArrowDown', 40)
          await key('Enter', 13)
        } else if (checked.dateParts) {
          for (const [index, part] of checked.dateParts.entries()) {
            for (let step = 0; step < 6; step++) await key('ArrowLeft', 37)
            for (let step = 0; step < index; step++) await key('ArrowRight', 39)
            await key('Backspace', 8)
            for (const character of part) {
              await checkInput()
              const code = character.charCodeAt(0)
              await command('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: character, windowsVirtualKeyCode: code })
              try {
                await checkInput()
                await command('Input.dispatchKeyEvent', { type: 'char', key: character, text: character, windowsVirtualKeyCode: code })
              } finally { await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: character, windowsVirtualKeyCode: code }) }
            }
          }
        } else if (checked.range) {
          const desired = Number(input.value), range = checked.range
          await key(desired - range.min <= range.max - desired ? 'Home' : 'End', desired - range.min <= range.max - desired ? 36 : 35)
          let value = Number((await checkInput()).value)
          while (Math.abs(value - desired) > range.step / 2) {
            const up = desired > value, page = Math.abs(desired - value) >= Math.max(range.step, (range.max - range.min) / 10) + range.step
            await key(page ? up ? 'PageUp' : 'PageDown' : up ? 'ArrowUp' : 'ArrowDown', page ? up ? 33 : 34 : up ? 38 : 40)
            const next = Number((await checkInput()).value)
            if (next === value) break
            value = next
          }
        } else {
          await key('a', 65, 2)
          await key('Backspace', 8)
          if (input.value) { await checkInput(); await command('Input.insertText', { text: input.value }) }
        }
        await key('Tab', 9)
        const actual = await checkInput(false)
        if (checked.range ? Number(actual.value) !== Number(input.value) : actual.value !== input.value)
          inputOutcome = { status: 'value-mismatch', requestedValue: input.value, actualValue: actual.value ?? '' }
      }
      frameFor(context, frameToken)
      return { applied: true, ...(inputOutcome ? { inputOutcome } : {}) }
    } finally { if (attachedHere && contents.debugger.isAttached()) contents.debugger.detach() }
  }

  async navigate(context: PageActionAutomationContext, frameToken: string, index: number): Promise<void> {
    if (isPublishedActionContext(context)) throw new Error('课件页面导航由正常播放器拥有')
    const { contents, frame } = frameFor(context, frameToken)
    const courseNavigated = await frame.executeJavaScript(htmlCourseNavigateScript(index))
    frameFor(context, frameToken)
    if (courseNavigated === true) return
    const posted = await contents.mainFrame.executeJavaScript(iframeScript(context.lease.url, 'navigate', context.lease.loadId, index))
    if (posted !== true) throw new Error('HTML 预览框架当前不可见或来源已变化')
    await new Promise(resolve => setTimeout(resolve, 80))
    frameFor(context, frameToken)
  }

  async capture(context: PageActionAutomationContext, frameToken: string): Promise<HtmlActionCapture> {
    const { contents, frame } = frameFor(context, frameToken)
    await prepareVisibleFramePaint(contents, frame)
    return this.captureReady(context, frameToken)
  }

  private async captureReady(context: PageActionAutomationContext, frameToken: string): Promise<HtmlActionCapture> {
    const { contents } = frameFor(context, frameToken)
    if (isPublishedActionContext(context)) {
      const bitmap = await contents.capturePage(), size = bitmap.getSize()
      frameFor(context, frameToken)
      if (bitmap.isEmpty() || size.width < 1 || size.height < 1) throw new Error('课件页面没有生成真实截图')
      return { png: new Uint8Array(bitmap.toPNG()), width: size.width, height: size.height }
    }
    const rect = await contents.mainFrame.executeJavaScript(iframeScript(context.lease.url, 'rect')) as {
      x: number; y: number; width: number; height: number; viewportWidth: number; viewportHeight: number
    } | null
    if (!rect) throw new Error('HTML 预览不可见，请打开该文档的预览')
    const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y))
    const fullWidth = Math.ceil(Math.min(rect.x + rect.width, rect.viewportWidth) - x)
    const fullHeight = Math.ceil(Math.min(rect.y + rect.height, rect.viewportHeight) - y)
    const minimum = 8, width = Math.min(2048, fullWidth), height = Math.min(2048, fullHeight)
    if (width < minimum || height < minimum) throw new Error('HTML 预览没有可见画面')
    const bitmap = await contents.capturePage({ x, y, width, height })
    frameFor(context, frameToken)
    const size = bitmap.getSize()
    if (bitmap.isEmpty() || size.width < minimum || size.height < minimum) throw new Error('HTML 预览没有生成真实截图')
    return { png: new Uint8Array(bitmap.toPNG()), width: size.width, height: size.height }
  }

  onDiagnostic(context: PageActionAutomationContext, frameToken: string,
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
