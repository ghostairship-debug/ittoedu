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

it('reads sibling owner geometry concurrently while retaining tree order and hidden-parent boundaries', async () => {
  type Frame = { processId: number; frameTreeNodeId: number; frameToken: string; url: string; detached: boolean;
    isDestroyed(): boolean; parent: Frame | null; frames: Frame[]; framesInSubtree: Frame[]; executeJavaScript(script: string): Promise<unknown> }
  const requested: string[] = [], owners = new Map<string, string>()
  let releaseFirst!: () => void
  const firstPending = new Promise<void>(resolve => { releaseFirst = resolve })
  const geometry = (name: string) => ({ x: name === 'second' ? 200 : 0, y: 0, scaleX: 1, scaleY: 1,
    viewportWidth: 100, viewportHeight: 100, clip: { x: name === 'second' ? 200 : 0, y: 0, width: 100, height: 100 },
    visible: name !== 'hidden', ...(name === 'hidden' ? { reason: 'not-visible' } : {}) })
  const create = (name: string, id: number, parent: Frame | null): Frame => ({ processId: 1, frameTreeNodeId: id,
    frameToken: name, url: `courseware-editor://app/${name}.html`, detached: false, isDestroyed: () => false,
    parent, frames: [], framesInSubtree: [], async executeJavaScript(script: string) {
      if (script === '({width:innerWidth,height:innerHeight})') return { width: 640, height: 480 }
      const posted = /parent\.postMessage\(("[^"]+")/.exec(script)
      if (posted) { owners.set(JSON.parse(posted[1]!), name); requested.push(name); return undefined }
      const read = /^window\[("[^"]+")\]$/.exec(script)
      if (read) {
        const owner = owners.get(JSON.parse(read[1]!))!
        if (owner === 'first') await firstPending
        return geometry(owner)
      }
      if (script.includes('"type":"observe"')) {
        current.order.push(`dom:${name}`)
        return { url: this.url, title: name, readyState: 'complete', pageIndex: 0, pageCount: 1,
          viewport: { width: 640, height: 480 }, structure: [name], diagnostics: [], elements: [] }
      }
      return undefined
    } })
  const root = create('root', 1, null), first = create('first', 2, root), hidden = create('hidden', 3, root), second = create('second', 4, root)
  hidden.frames = [create('hidden-inner', 5, hidden)]
  root.frames = [first, hidden, second]
  root.framesInSubtree = [root, first, hidden, ...hidden.frames, second]
  current.contents = { mainFrame: root, isDestroyed: () => false }
  const context: PublishedActionAutomationContext = { kind: 'published', runId: 'run', webContentsId: 1,
    frameProcessId: 1, frameToken: 'root', url: root.url,
    identity: { documentId: 'doc', epoch: 'epoch', revision: 1, projectId: 'project', locationId: 'page', stateId: null, viewGeneration: 'view' } }
  const observation = new HtmlActionDesktopPort().observe(context, 'root')
  try {
    // The first sibling is deliberately pending: a serial traversal cannot
    // start the second sibling's read until this assertion has already failed.
    await vi.waitFor(() => expect(requested.slice(0, 3)).toEqual(['first', 'hidden', 'second']))
    releaseFirst()
    const observed = await observation
    expect(observed.structure).toEqual(['root', 'first', 'second'])
    expect(observed.observationScope?.frames.map(frame => frame.frameId)).toEqual([1, 2, 4, 3])
    expect(observed.observationScope?.frames.at(-1)).toMatchObject({ frameId: 3, status: 'not-visible' })
    expect(requested).not.toContain('hidden-inner')
    expect(current.order).toEqual(['paint', 'dom:root', 'dom:first', 'dom:second'])
  } finally { releaseFirst(); await observation.catch(() => {}) }
})
