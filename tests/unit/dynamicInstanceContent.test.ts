import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { componentHasVisibleContent } from '@/renderer/authoring/tools/dynamicInstanceContent'

const rect = { x: 0, y: 0, left: 0, top: 0, right: 830, bottom: 240, width: 830, height: 240, toJSON() {} }
let pseudo: CSSStyleDeclaration
beforeEach(() => {
  const actualStyle = window.getComputedStyle.bind(window)
  pseudo = document.createElement('div').style
  pseudo.content = 'none'
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, generated) => generated ? pseudo : actualStyle(element))
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect)
  vi.spyOn(document, 'createRange').mockReturnValue({ selectNodeContents() {}, getBoundingClientRect: () => rect } as unknown as Range)
})
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

function host() {
  const mount = document.createElement('div'), shadow = mount.attachShadow({ mode: 'open' }), root = document.createElement('div')
  mount.style.cssText = 'width:830px;height:240px'
  root.style.cssText = 'width:100%;height:100%;color:rgb(0,0,0)'
  shadow.append(root); document.body.append(mount)
  return { mount, root }
}

describe('generated component empty-content gate', () => {
  it('rejects an empty fixed frame even when an unattached interface was constructed', async () => {
    const { mount } = host(), detached = document.createElement('section')
    detached.textContent = '预测并操作开关'
    const capture = vi.fn(async () => false)
    expect(await componentHasVisibleContent(mount, 'transparent-png', capture)).toBe(false)
    expect(capture).toHaveBeenCalledOnce()
  })

  it.each(['background', 'border', 'outline', 'text', 'pseudo'] as const)('preserves actual %s paint and avoids decoding the PNG again', async kind => {
    const { mount, root } = host()
    if (kind === 'background') root.style.backgroundColor = 'rgb(40, 80, 120)'
    if (kind === 'border') root.style.border = '2px solid rgb(40, 80, 120)'
    if (kind === 'outline') { root.style.outlineWidth = '2px'; root.style.outlineStyle = 'solid'; root.style.outlineColor = 'rgb(40, 80, 120)' }
    if (kind === 'text') root.textContent = '实际已挂载文字'
    if (kind === 'pseudo') { pseudo.content = '"预测"'; pseudo.color = 'rgb(0, 0, 0)' }
    const capture = vi.fn(async () => false)
    expect(await componentHasVisibleContent(mount, 'png', capture)).toBe(true)
    expect(capture).not.toHaveBeenCalled()
  })

  it.each([true, false])('uses captured Canvas/WebGL pixels rather than treating the canvas tag as content (%s)', async painted => {
    const { mount, root } = host()
    root.append(document.createElement('canvas'))
    const capture = vi.fn(async () => painted)
    expect(await componentHasVisibleContent(mount, 'canvas-png', capture)).toBe(painted)
    expect(capture).toHaveBeenCalledOnce()
  })

  it('ignores detached, hidden and transparent content but retains actual image pixels', async () => {
    const { mount, root } = host(), text = document.createElement('p')
    text.style.display = 'none'; text.textContent = '隐藏文本'
    root.append(text)
    root.style.backgroundColor = 'rgba(0,0,0,0)'
    expect(await componentHasVisibleContent(mount, 'transparent-png', async () => false)).toBe(false)
    root.append(document.createElement('img'))
    expect(await componentHasVisibleContent(mount, 'image-png', async () => true)).toBe(true)
  })
})
