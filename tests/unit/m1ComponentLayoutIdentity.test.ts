import { expect, it } from 'vitest'
import { componentLayoutInput, isMeasuredWebFragmentBox } from '../../src/components/web/measuredFragmentBox'
import { componentPaintStyle } from '../../src/shared/componentPaintStyle'
import { applyComponentPaintStyle } from '../../src/player/components/componentPlacementStyle'
import type { ComponentDefinition, ComponentInstance } from '../../src/shared/contracts/component-platform'

const definition: ComponentDefinition = {
  id: 'imported-web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' },
}
const instance: ComponentInstance = {
  id: 'imported-title', definitionId: definition.id,
  data: { html: '<h1>保留库内标题</h1>' },
  style: { padding: '12px', 'background-color': 'blue' },
  frame: { width: 300, height: 80, transform: [1, 0, 0, 1, 20, 30] },
}

it('keeps a rebound builtin Web fragment under one frame and one CSS paint owner', () => {
  expect(componentLayoutInput(instance, { project: { instances: { [instance.id]: instance }, definitions: { [definition.id]: definition } }, kind: 'flow', inlineSize: 640, definition }))
    .toEqual({ mode: 'flow-content', inlineSize: 640 })
  expect(isMeasuredWebFragmentBox(instance, 'fragment', undefined, definition)).toBe(true)
  expect(componentPaintStyle(instance, definition)).toEqual({})
  const element = document.createElement('div')
  applyComponentPaintStyle(element, instance)
  expect(element.style.padding).toBe('12px')
  applyComponentPaintStyle(element, instance, definition)
  expect(element.style.padding).toBe('')
  expect(element.style.backgroundColor).toBe('')
  expect(instance.frame).toEqual({ width: 300, height: 80, transform: [1, 0, 0, 1, 20, 30] })
})

it('keeps explicit documents and customized source outside builtin fragment normalization', () => {
  expect(isMeasuredWebFragmentBox(instance, 'document', undefined, definition)).toBe(false)
  const custom: ComponentInstance = { ...instance, implementationOverride: { kind: 'source', language: 'javascript', source: 'export default {}' } }
  expect(isMeasuredWebFragmentBox(custom, 'fragment', undefined, definition)).toBe(false)
  expect(componentPaintStyle(custom, definition)).toMatchObject({ padding: '12px', backgroundColor: 'blue' })
  const changedDefinition: ComponentDefinition = { ...definition, implementation: { kind: 'builtin', key: 'guoling.shape' } }
  expect(isMeasuredWebFragmentBox({ ...instance, definitionId: 'guoling.web' }, 'fragment', undefined, changedDefinition)).toBe(false)
})

it('uses the effective bounded program and formal frame before inferring Web CSS in Flow', () => {
  const html = '<!doctype html><html><body><h1>Local program</h1><button>Apply</button></body></html>'
  const framed: ComponentInstance = { ...instance, data: { html },
    frame: { width: 640, height: 360, transform: [1, 0, 0, 1, 0, 0] } }
  const input = (value: ComponentInstance, declared = definition, fixedViewport?: boolean) => componentLayoutInput(value, {
    project: { instances: { [value.id]: value }, definitions: { [declared.id]: declared } },
    kind: 'flow', inlineSize: 480, definition: declared,
  }, fixedViewport)
  const expected = { mode: 'flow-viewport', inlineSize: 640, blockSize: 360 }
  expect(input({ ...framed, implementationOverride: { kind: 'builtin', key: 'guoling.html-program' } }, definition, false)).toEqual(expected)
  expect(input(framed, { ...definition, implementation: { kind: 'builtin', key: 'guoling.html-program' } }, false)).toEqual(expected)
  expect(input({ ...framed, implementationOverride: { kind: 'source', language: 'javascript', source: 'export default {}' } }, definition, false)).toEqual(expected)
  expect(input({ ...framed, definitionId: 'guoling.web', implementationOverride: { kind: 'source', language: 'javascript', source: 'export default {}' } }, { ...definition, id: 'guoling.web' }, false)).toEqual(expected)
  // A Web reading block may have a measured frame without authoring a viewport.
  expect(input(framed, definition, false)).toEqual({ mode: 'flow-content', inlineSize: 480 })
  expect(input({ ...framed, frame: undefined, implementationOverride: { kind: 'builtin', key: 'guoling.html-program' } }, definition, false))
    .toEqual({ mode: 'flow-content', inlineSize: 480 })
})


it('keeps inline and behavior children in natural Flow while preserving real free child geometry', () => {
  const text: ComponentDefinition = { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
  const input: ComponentDefinition = { id: 'input', role: 'content', implementation: { kind: 'builtin', key: 'guoling.input' } }
  const behavior: ComponentDefinition = { id: 'annotation', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.popover' } }
  const answer: ComponentInstance = { id: 'answer', definitionId: 'input', data: {}, frame: { width: 120, height: 40, transform: [1, 0, 0, 1, 10, 10] } }
  const annotation: ComponentInstance = { id: 'annotation', definitionId: 'annotation', data: {} }
  const body: ComponentInstance = { id: 'body', definitionId: 'text', childIds: ['answer', 'annotation'], data: { content: { inlines: [{ type: 'component', instanceId: 'answer', accessibleText: 'Answer' }] } } }
  const project = { definitions: { text, input, annotation: behavior }, instances: { body, answer, annotation } }
  expect(componentLayoutInput(body, { project, kind: 'flow', inlineSize: 788, definition: text })).toEqual({ mode: 'flow-content', inlineSize: 788 })
  const ordinary = { ...body, data: { content: { inlines: [{ type: 'text', text: 'Ordinary child placement' }] } } }
  expect(componentLayoutInput(ordinary, { project, kind: 'flow', inlineSize: 788, viewport: { width: 140, height: 60 }, definition: text })).toEqual({ mode: 'flow-viewport', inlineSize: 140, blockSize: 60 })
  const webOwner = { ...ordinary, definitionId: definition.id, data: { html: '<p>Natural Web source with a free child</p>' } }
  expect(componentLayoutInput(webOwner, { project: { ...project, definitions: { ...project.definitions, [definition.id]: definition } }, kind: 'flow', inlineSize: 788, viewport: { width: 140, height: 60 }, definition }, false)).toEqual({ mode: 'flow-viewport', inlineSize: 140, blockSize: 60 })
})
