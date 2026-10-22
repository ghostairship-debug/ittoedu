// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import type { PublishedActionAutomationContext } from '../../src/main/workbench/observation/HtmlActionDesktopPort'

const current = vi.hoisted(() => ({ order: [] as string[], contents: undefined as unknown }))
vi.mock('electron', () => ({ webContents: { fromId: () => current.contents } }))
vi.mock('../../src/main/workbench/observation/captureFramePaint', () => ({
  async waitForCaptureFramePaint() { current.order.push('paint') },
}))
import { HtmlActionDesktopPort } from '../../src/main/workbench/observation/HtmlActionDesktopPort'

beforeEach(() => { current.order = [] })

it('uses the same completed frame paint for a read-only DOM sample and its immediately following pixels', async () => {
  const frame = { processId: 1, frameToken: 'root', url: 'courseware-editor://app/observation.html', detached: false,
    isDestroyed: () => false, frames: [], framesInSubtree: [], async executeJavaScript(script: string) {
      if (script === '({width:innerWidth,height:innerHeight})') return { width: 640, height: 480 }
      if (script.includes('"type":"observe"')) {
        current.order.push('dom')
        return { url: frame.url, title: 'ready', readyState: 'complete', pageIndex: 0, pageCount: 1, structure: [], diagnostics: [], elements: [] }
      }
      return undefined
    } }
  const png = Uint8Array.of(1, 2, 3)
  current.contents = { mainFrame: frame, isDestroyed: () => false, async capturePage() {
    current.order.push('pixels')
    return { getSize: () => ({ width: 640, height: 480 }), isEmpty: () => false, toPNG: () => png }
  } }
  const context: PublishedActionAutomationContext = { kind: 'published', runId: 'run', webContentsId: 1,
    frameProcessId: 1, frameToken: 'root', url: frame.url,
    identity: { documentId: 'doc', epoch: 'epoch', revision: 1, projectId: 'project', locationId: 'page', stateId: null, viewGeneration: 'view' } }
  const port = new HtmlActionDesktopPort()
  const observed = await port.observeAndCapture(context, 'root')
  expect(observed.state.title).toBe('ready')
  expect(observed.capture.png).toEqual(png)
  expect(current.order).toEqual(['paint', 'dom', 'pixels'])
  await port.capture(context, 'root')
  expect(current.order.slice(3)).toEqual(['paint', 'pixels'])
})
