import { describe, expect, it } from 'vitest'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import type { PublishedCourseV4 } from '../../src/shared/contracts/component-platform/published'

function fixture(): PublishedCourseV4 {
  return {
    schemaVersion: 4, id: 'mixed', title: 'mixed', rootIds: ['reading'], entry: { rootInstanceId: 'reading' },
    definitions: {
      flow: { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
      slide: { id: 'slide', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.slide' } },
      text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
    },
    instances: {
      reading: { id: 'reading', definitionId: 'flow', name: 'Reading', data: {}, childIds: ['left', 'right'],
        container: { kind: 'flow', flow: { layout: { readingWidth: 860, wideContentWidth: 1100 } } } },
      left: { id: 'left', definitionId: 'slide', data: {}, childIds: ['left-text'],
        container: { kind: 'slide', designSize: { width: 400, height: 250 },
          presentation: { initialStateId: 'overview', states: [
            { id: 'overview', title: 'Overview', overrides: {} },
            { id: 'detail', title: 'Detail', overrides: { 'left-text': { data: { text: 'left detail' } } } },
          ] } } },
      right: { id: 'right', definitionId: 'slide', data: {}, childIds: ['right-text'],
        container: { kind: 'slide', designSize: { width: 400, height: 250 },
          presentation: { initialStateId: 'overview', states: [
            { id: 'overview', title: 'Overview', overrides: {} },
            { id: 'detail', title: 'Detail', overrides: { 'right-text': { data: { text: 'right detail' } } } },
          ] } } },
      'left-text': { id: 'left-text', definitionId: 'text', data: { text: 'left' } },
      'right-text': { id: 'right-text', definitionId: 'text', data: { text: 'right' } },
    },
    global: { underlay: [], overlay: [] }, assets: {},
  }
}

const compile = (payload: PublishedCourseV4) => compileCoursePlayback(payload, {
  document,
  renderBuiltin: async instance => `<p>${(instance.data as { text: string }).text}</p>`,
})

describe('Project11 compiled markup', () => {
  it('uses the responsive Flow paper width in formal compiled markup', async () => {
    const payload = fixture()
    payload.instances.reading.container!.designSize = { width: 1280, height: 900 }
    const artifact = await compile(payload), root = document.createElement('div'); root.innerHTML = artifact.html
    const paper = root.querySelector<HTMLElement>('[data-compiled-flow-paper="reading"]')!
    expect(paper.style.width).toBe('100%')
    expect(paper.style.maxWidth).toBe('860px')
  })

  it('owns each nested subtree once and prepares independent local state variants', async () => {
    const payload = fixture(), before = structuredClone(payload)
    const artifact = await compile(payload)
    const root = document.createElement('div'); root.innerHTML = artifact.html

    expect(artifact.format).toBe('compiled-course-v2')
    expect(artifact.diagnostics).toEqual([])
    expect(root.querySelectorAll('[data-compiled-surface]')).toHaveLength(3)
    expect(root.querySelectorAll('[data-compiled-runtime-root="reading"]')).toHaveLength(1)
    for (const id of ['left', 'right']) {
      const section = root.querySelector<HTMLElement>(`[data-compiled-surface="${id}"]`)!
      expect(section.dataset.compiledParentContainer).toBe('reading')
      expect(root.querySelectorAll(`[data-compiled-runtime-root="${id}"]`)).toHaveLength(1)
      expect(section.querySelectorAll(`[data-compiled-node="${id}-text"]`)).toHaveLength(1)
      expect(root.querySelectorAll(`[data-compiled-node="${id}-text"]`)).toHaveLength(1)
      const textNode = root.querySelector<HTMLElement>(`[data-compiled-node="${id}-text"]`)!
      expect(textNode.querySelector('p')!.closest('[data-component-instance-id]')).toBe(textNode)
      expect(textNode.dataset.componentInstanceId).toBe(`${id}-text`)
      expect(artifact.staticViews[`${id}-text`].map(view => view.html)).toEqual([`<p>${id}</p>`, `<p>${id} detail</p>`])
    }
    expect(payload).toEqual(before)
    expect(artifact.course).not.toHaveProperty('surfaces')
  })

  it('selects the declared entry instead of the first root', async () => {
    const payload = fixture()
    payload.rootIds = ['left', 'reading']
    payload.instances.reading.childIds = ['right']
    payload.entry = { rootInstanceId: 'left' }
    const artifact = await compile(payload), root = document.createElement('div'); root.innerHTML = artifact.html
    expect(root.querySelector<HTMLElement>('[data-compiled-root="left"]')!.hidden).toBe(false)
    expect(root.querySelector<HTMLElement>('[data-compiled-root="reading"]')!.hidden).toBe(true)
    expect(root.querySelectorAll('[data-compiled-runtime-root="left"]')).toHaveLength(1)
  })

  it('keeps a pure HTML program as a viewport root with its real script', async () => {
    const payload: PublishedCourseV4 = {
      schemaVersion: 4, id: 'app', title: 'App', rootIds: ['program'], entry: { rootInstanceId: 'program' },
      definitions: { app: { id: 'app', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.html-program' } } },
      instances: { program: { id: 'program', definitionId: 'app', data: {
        html: '<button id="increment">0</button><canvas id="world"></canvas><script>document.getElementById("increment").onclick=function(){this.textContent=String(Number(this.textContent)+1)}</script>',
      } } },
      global: { underlay: [], overlay: [] }, assets: {},
    }
    const artifact = await compile(payload), root = document.createElement('div'); root.innerHTML = artifact.html
    expect(root.querySelectorAll('[data-compiled-surface]')).toHaveLength(0)
    expect(root.querySelectorAll('[data-compiled-program-root="program"]')).toHaveLength(1)
    const node = root.querySelector<HTMLElement>('[data-compiled-program-viewport]')!
    expect(node.style.width).toBe('100%'); expect(node.style.height).toBe('100%')
    expect(node.style.transform).toBe('')
    expect(root.querySelectorAll('[data-compiled-runtime-root="program"]')).toHaveLength(1)
    expect(artifact.webPrograms.program).toHaveLength(1)
    expect(artifact.webPrograms.program[0].program.classicPrograms).toHaveLength(1)
    expect(artifact.diagnostics).toEqual([])
  })
})
