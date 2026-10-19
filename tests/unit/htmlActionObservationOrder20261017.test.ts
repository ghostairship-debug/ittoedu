// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import type { PublishedActionAutomationContext } from '../../src/main/workbench/observation/HtmlActionDesktopPort'

const current = vi.hoisted(() => ({ painted: false, order: [] as string[], contents: undefined as unknown }))
vi.mock('electron', () => ({ webContents: { fromId: () => current.contents } }))
vi.mock('../../src/main/workbench/observation/captureFramePaint', () => ({
  async waitForCaptureFramePaint() { current.order.push('paint'); current.painted = true },
}))
import { HtmlActionDesktopPort } from '../../src/main/workbench/observation/HtmlActionDesktopPort'

beforeEach(() => { current.painted = false; current.order = [] })

it('prepares frame paint before sampling the returned DOM, rather than only before PNG capture', async () => {
  const frame = { processId: 1, frameToken: 'root', url: 'courseware-editor://app/observation.html', detached: false,
    isDestroyed: () => false, frames: [], framesInSubtree: [], async executeJavaScript(script: string) {
      if (script === '({width:innerWidth,height:innerHeight})') return { width: 640, height: 480 }
      if (script.includes('"type":"observe"')) {
        current.order.push('dom')
        return { url: frame.url, title: current.painted ? 'I30 / 1800 / 2200' : 'I8 / 480 / 3520', readyState: 'complete',
          pageIndex: 0, pageCount: 1, structure: [], diagnostics: [], elements: [] }
      }
      // Existing root readiness; the child-frame paint barrier is distinct.
      return undefined
    } }
  current.contents = { mainFrame: frame, isDestroyed: () => false }
  const context: PublishedActionAutomationContext = { kind: 'published', runId: 'run', webContentsId: 1,
    frameProcessId: 1, frameToken: 'root', url: frame.url,
    identity: { documentId: 'doc', epoch: 'epoch', revision: 1, projectId: 'project', locationId: 'page', stateId: null, viewGeneration: 'view' } }
  const observed = await new HtmlActionDesktopPort().observe(context, 'root')
  expect(observed.title).toBe('I30 / 1800 / 2200')
  expect(current.order).toEqual(['paint', 'dom'])
})
