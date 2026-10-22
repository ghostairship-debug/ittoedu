import { afterEach, expect, it, vi } from 'vitest'
import { createTextComponentData } from '../../src/components/text/data'
import type { ComponentLayoutInput, ComponentRuntimeContext, MountedComponent } from '../../src/shared/contracts/component-platform'
import type { ComponentInstance, JsonValue } from '../../src/shared/contracts/component-platform/project'

const observed = vi.hoisted(() => ({ measure: vi.fn(() => ({ width: 100, height: 30, scale: 1, overflows: false })) }))
vi.mock('../../src/components/text/render', () => ({
  measureTextComponent: observed.measure, applyTextComponentLayout: vi.fn(),
  renderTextComponent: (dom: Document, data: ReturnType<typeof createTextComponentData>) => {
    const element = dom.createElement('div'); element.style.font = '24px "Noto Sans SC"'
    element.textContent = data.content.inlines.map(inline => inline.type === 'text' ? inline.text : '').join('')
    return element
  }, renderFormulaComponent: vi.fn(),
}))
import { textRuntimeImplementation } from '../../src/components/text/runtime'

afterEach(() => { vi.restoreAllMocks(); observed.measure.mockClear(); document.body.replaceChildren() })

it('waits for the latest actual text demand before emitting a precise layout', async () => {
  const finish: (() => void)[] = []
  const fonts = { check: vi.fn(() => false), load: vi.fn(() => new Promise<void>(resolve => finish.push(resolve))) }
  const previous = Object.getOwnPropertyDescriptor(document, 'fonts')
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
  const root = document.createElement('div'); document.body.append(root)
  const textData = (text: string): JsonValue => JSON.parse(JSON.stringify(createTextComponentData(text)))
  const initial: ComponentInstance = { id: 'text', definitionId: 'definition', frame: { width: 100, height: 30, transform: [1, 0, 0, 1, 0, 0] }, data: textData('旧文') }
  const scope: ComponentRuntimeContext['scope'] = { runScopeId: 'font-demand', instanceId: 'text', generation: 1,
    isActive: () => true, signal: new AbortController().signal, cleanup: vi.fn(), target: () => null,
    events: { emit: vi.fn(), subscribe: () => () => {} }, state: { get: () => undefined, set() {}, subscribe: () => () => {} } }
  let handle: MountedComponent | undefined
  try {
    handle = await textRuntimeImplementation.mount({ instance: initial, root, scope })
    expect(observed.measure).not.toHaveBeenCalled()
    await handle.update({ ...initial, data: textData('新文') })
    expect(root.textContent).toBe('新文')
    finish[0]!(); await Promise.resolve(); await Promise.resolve()
    expect(observed.measure).not.toHaveBeenCalled()
    finish[1]!()
    await vi.waitFor(() => expect(observed.measure).toHaveBeenCalledTimes(1))
    expect(scope.events.emit).toHaveBeenCalledWith('text.layout', expect.any(Object))
  } finally {
    handle?.dispose()
    if (previous) Object.defineProperty(document, 'fonts', previous)
    else Reflect.deleteProperty(document, 'fonts')
  }
})

it('consumes the accepted natural layout notification without rereading live geometry', async () => {
  const root = document.createElement('div'); document.body.append(root)
  const read = vi.fn((): ComponentLayoutInput => ({ mode: 'flow-content', inlineSize: 390 }))
  let changed: ((input: ComponentLayoutInput) => void) | undefined
  const scope: ComponentRuntimeContext['scope'] = { runScopeId: 'layout-demand', instanceId: 'text', generation: 1,
    isActive: () => true, signal: new AbortController().signal, cleanup: vi.fn(), target: () => null,
    events: { emit: vi.fn(), subscribe: () => () => {} }, state: { get: () => undefined, set() {}, subscribe: () => () => {} } }
  const handle = await textRuntimeImplementation.mount({ root, scope,
    instance: { id: 'text', definitionId: 'definition', frame: { width: 100, height: 30, transform: [1, 0, 0, 1, 0, 0] },
      data: JSON.parse(JSON.stringify(createTextComponentData('自然段落'))) },
    layout: { read, reportSize() {}, subscribe(listener) { changed = listener; return () => {} } } })
  try {
    expect(read).toHaveBeenCalledTimes(1)
    const element = root.firstElementChild
    read.mockClear()
    changed!({ mode: 'flow-content', inlineSize: 420 })
    expect(read).not.toHaveBeenCalled()
    expect(root.firstElementChild).toBe(element)
    expect(observed.measure).not.toHaveBeenCalled()
  } finally { handle.dispose() }
})
