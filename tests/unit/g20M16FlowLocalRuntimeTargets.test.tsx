import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { FlowPageRuntime } from '@/renderer/ui/flow/FlowPageRuntime'
import type { RuntimeLayerItem } from '@/shared/courseProjectTypes'
import type { RuntimeAuthoringTarget, RuntimeAuthoringTargetUpdate } from '@/shared/runtimeTypes'

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) }
}

function target(
  updates: RuntimeAuthoringTargetUpdate[],
  source: RuntimeAuthoringTarget['source'],
  kind: RuntimeAuthoringTarget['kind'],
  label?: string,
): RuntimeAuthoringTarget {
  const latest = updates.at(-1)?.targets ?? []
  const found = latest.find(item => item.source === source && item.kind === kind && (!label || item.label === label))
  if (!found) throw new Error(`Missing ${source} ${kind} target ${label ?? ''}: ${JSON.stringify(latest)}`)
  return found
}

it('reports Flow Runtime text, image, and registered targets in the live local frame on mount and resize', async () => {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const doc = frame.contentDocument!
  const view = frame.contentWindow as Window & typeof globalThis
  const container = doc.createElement('div')
  doc.body.append(container)
  const reactRoot = createRoot(container)
  let width = 440
  let height = 260
  let buttonX = 210
  const selected = new WeakMap<Range, Node>()
  const select = view.Range.prototype.selectNodeContents
  Object.defineProperty(view.Range.prototype, 'selectNodeContents', {
    configurable: true,
    value: function (this: Range, node: Node) { selected.set(this, node); return select.call(this, node) },
  })
  Object.defineProperty(view.Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: function (this: Range) {
      return selected.get(this)?.parentElement?.tagName === 'BUTTON'
        ? rect(buttonX, 100, 70, 30)
        : rect(20, 20, 150, 30)
    },
  })
  Object.defineProperty(view.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: function (this: HTMLElement) {
      return this.tagName === 'IMG' ? rect(300, 80, 60, 40) : rect(0, 0, width, height)
    },
  })

  const source = `CoursewareRuntime.define({runtimeApiVersion:3,create(ctx){
    const heading=document.createElement('h2'); heading.textContent='Lesson title'; ctx.dom.root.appendChild(heading);
    const button=document.createElement('button'); button.textContent='Next step'; ctx.dom.root.appendChild(button);
    const image=document.createElement('img'); image.src=ctx.assets.url('hero'); ctx.dom.root.appendChild(image);
    ctx.authoring.registerText({key:'title',label:'Registered title',bounds:{x:210,y:100,width:70,height:30}});
    ctx.authoring.registerAsset({key:'hero',label:'Registered image',bounds:{x:300,y:80,width:60,height:40}});
    return {destroy(){ctx.dom.root.replaceChildren()},resize(){ctx.authoring.invalidate()}};
  }})`
  const item: RuntimeLayerItem = {
    layerItemId: 'runtime-local', label: 'Local runtime', kind: 'runtime',
    frame: { mode: 'absolute', x: 0, y: 0, width: 440, height: 260 }, order: 1,
    visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit', paperSpace: 'paper',
    runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true,
      renderMode: 'dom', source, content: { values: { title: 'Lesson title' } },
      assets: { hero: { assetId: 'image-1' } } },
  }
  const updates: RuntimeAuthoringTargetUpdate[] = []
  const props = { item, surfaceId: 'flow-local', assetUrls: { 'image-1': 'data:image/png;base64,SEVSTw==' },
    onTargetsChanged: (update: RuntimeAuthoringTargetUpdate) => updates.push(update), onHeightChange: vi.fn() }

  try {
    await act(async () => reactRoot.render(<FlowPageRuntime {...props} width={width} height={height} />))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(target(updates, 'auto', 'text', 'Lesson title').bounds).toEqual({ x: 20, y: 20, width: 150, height: 30 })
    expect(target(updates, 'auto', 'text', 'Next step').bounds).toEqual({ x: 210, y: 100, width: 70, height: 30 })
    expect(target(updates, 'auto', 'asset').bounds).toMatchObject({ x: 300, y: 80, width: expect.closeTo(60, 8), height: 40 })
    expect(target(updates, 'registered', 'text', 'Registered title').bounds).toEqual({ x: 210, y: 100, width: 70, height: 30 })
    expect(target(updates, 'registered', 'asset', 'Registered image').bounds).toEqual({ x: 300, y: 80, width: 60, height: 40 })

    width = 550
    height = 300
    buttonX = 250
    await act(async () => reactRoot.render(<FlowPageRuntime {...props} width={width} height={height} />))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(target(updates, 'auto', 'text', 'Next step').bounds).toMatchObject({ x: 250, y: 100, width: expect.closeTo(70, 8), height: 30 })
    expect(target(updates, 'auto', 'asset').bounds).toMatchObject({ x: 300, y: 80, width: expect.closeTo(60, 8), height: 40 })
    expect(target(updates, 'registered', 'text', 'Registered title').bounds).toEqual({ x: 210, y: 100, width: 70, height: 30 })
  } finally {
    await act(async () => reactRoot.unmount())
    frame.remove()
  }
})
