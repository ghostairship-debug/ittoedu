import { expect, it } from 'vitest'
import { componentLayoutInput, isMeasuredWebFragmentBox } from '../../src/components/web/measuredFragmentBox'
import { applyComponentPaintStyle, componentPaintStyle } from '../../src/player/components/componentPlacementStyle'
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
  expect(componentLayoutInput(instance, { kind: 'flow', inlineSize: 640, definition }))
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
