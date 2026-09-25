// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { DomTextOverrides, domTextRegion, isLiveComputedText } from '../../src/player/lightEdit/domTextOverrides'
import { PHASER_TEXT_REGION, PhaserTextOverrides } from '../../src/player/lightEdit/phaserTextOverrides'

const settle = () => new Promise(resolve => setTimeout(resolve, 0))
let root: HTMLDivElement
afterEach(() => root?.remove())

function mount(html: string): HTMLDivElement {
  root = document.createElement('div')
  root.innerHTML = html
  document.body.append(root)
  return root
}

it('replaces text the Runtime renders, keeps its surrounding whitespace and follows its rerenders', async () => {
  const page = mount('<section><h2>  听力练习 </h2><button>下一题</button></section>')
  const engine = new DomTextOverrides([page], [{ original: '听力练习', text: '听力训练' }])
  engine.applyAll()
  expect(page.querySelector('h2')!.textContent).toBe('  听力训练 ')

  // The Runtime rerenders the heading: the new node is rewritten, then a new original is left alone.
  page.querySelector('h2')!.textContent = '听力练习'
  await settle()
  expect(page.querySelector('h2')!.textContent).toBe('听力训练')
  page.querySelector('h2')!.textContent = '第二部分'
  await settle()
  expect(page.querySelector('h2')!.textContent).toBe('第二部分')
  engine.destroy()
})

it('scopes a rule to the region it was made in and prefers it over an everywhere rule', () => {
  const page = mount('<div><p>开始</p></div><button>开始</button>')
  const paragraph = page.querySelector('p')!.firstChild as Text
  expect(domTextRegion(paragraph, page)).toBe('div>p')
  const engine = new DomTextOverrides([page], [
    { original: '开始', region: 'div>p', text: '开始阅读' },
    { original: '开始', text: '开始作答' },
  ])
  engine.applyAll()
  expect(page.querySelector('p')!.textContent).toBe('开始阅读')
  expect(page.querySelector('button')!.textContent).toBe('开始作答')
  engine.destroy()
})

it('restores the Runtime text exactly when a rule is removed (undo) and reapplies on redo', () => {
  const page = mount('<p>原来的说明</p>')
  const engine = new DomTextOverrides([page], [{ original: '原来的说明', text: '新的说明' }])
  engine.applyAll()
  expect(page.textContent).toBe('新的说明')
  engine.setRules([])
  expect(page.textContent).toBe('原来的说明')
  engine.setRules([{ original: '原来的说明', text: '新的说明' }])
  expect(page.textContent).toBe('新的说明')
  expect(engine.samples()).toMatchObject([{ original: '原来的说明', shown: '新的说明', region: 'p', live: false }])
  engine.destroy()
})

it('leaves scripts, styles, typed fields and editable regions alone', () => {
  const page = mount('<style>.a{}</style><textarea>开始</textarea><div contenteditable="true">开始</div><p>开始</p>')
  const engine = new DomTextOverrides([page], [{ original: '开始', text: '改' }])
  engine.applyAll()
  expect(page.querySelector('textarea')!.value).toBe('开始')
  expect(engine.samples().map(sample => sample.region)).toEqual(['p'])
  engine.destroy()
})

it('treats counters and fast-changing text as program-computed', () => {
  expect(isLiveComputedText('12', [])).toBe(true)
  expect(isLiveComputedText('00:30', [])).toBe(true)
  const now = Date.now()
  expect(isLiveComputedText('得分 3', [now - 2000, now - 1000, now])).toBe(true)
  expect(isLiveComputedText('第一题', [now - 60_000, now - 30_000, now])).toBe(false)
})

it('shows Phaser Text through the rules while the Runtime keeps calling setText', () => {
  class FakeText {
    active = true
    visible = true
    _text = ''
    constructor(value: string) { this.setText(value) }
    get text() { return this._text }
    set text(value: string) { this.setText(value) }
    setText(value: string | string[]) { this._text = Array.isArray(value) ? value.join('\n') : String(value); return this }
  }
  const objects: FakeText[] = [new FakeText('开始游戏')]
  const engine = new PhaserTextOverrides(
    () => objects as never,
    (object): object is never => object instanceof FakeText,
    [{ original: '开始游戏', region: PHASER_TEXT_REGION, text: '开始挑战' }],
  )
  expect(engine.scan()).toBe(true)
  expect(objects[0]!.text).toBe('开始挑战')
  objects[0]!.setText('再来一次')
  expect(objects[0]!.text).toBe('再来一次')
  objects[0]!.text = '开始游戏'
  expect(objects[0]!.text).toBe('开始挑战')
  engine.setRules([])
  expect(objects[0]!.text).toBe('开始游戏')
  expect(engine.samples()).toMatchObject([{ original: '开始游戏', shown: '开始游戏' }])
  engine.destroy()
  expect(Object.hasOwn(objects[0]!, 'setText')).toBe(false)
})

it('publishes text and images the Runtime renders without registering, in course-canvas coordinates', async () => {
  const { RuntimeAuthoringTargetRegistry } = await import('../../src/player/RuntimeAuthoringTargetRegistry')
  const rect = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) }) as DOMRect
  const underlay = document.createElement('div')
  const overlay = mount('<main><h2>听力练习</h2><p><span>12</span></p><img src="blob:photo"></main>')
  document.body.append(underlay)
  overlay.getBoundingClientRect = () => rect(0, 0, 640, 360)
  underlay.getBoundingClientRect = () => rect(0, 0, 640, 360)
  overlay.querySelector('img')!.getBoundingClientRect = () => rect(100, 100, 50, 40)
  // jsdom has no Range layout; every text measures one fixed box here.
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect(20, 10, 80, 24) })
  const dom = new DomTextOverrides([underlay, overlay], [{ original: '听力练习', region: 'main>h2', text: '听力训练' }])
  dom.applyAll()
  const onTargetsChanged = vi.fn()
  const registry = new RuntimeAuthoringTargetRegistry({
    scope: 'scene', sceneId: 'scene-1', width: 640, height: 360, canvas: { width: 1280, height: 720 },
    content: { values: {} }, assets: { photo: { assetId: 'asset-photo' } },
    domRoots: { underlay, overlay },
    lightEdit: { dom, assetKeyForUrl: url => url === 'blob:photo' ? 'photo' : undefined },
    onTargetsChanged,
  })
  await settle()
  const targets = onTargetsChanged.mock.lastCall![0].targets
  expect(targets).toEqual([
    expect.objectContaining({
      kind: 'text', source: 'auto', key: '', label: '听力训练', layer: 'overlay',
      bounds: { x: 40, y: 20, width: 160, height: 48 },
      lightEdit: { original: '听力练习', region: 'main>h2', text: '听力训练' },
    }),
    // The counter "12" is program-computed: AI-only, not a direct target.
    expect.objectContaining({ kind: 'asset', source: 'auto', key: 'photo', bounds: { x: 200, y: 200, width: 100, height: 80 } }),
  ])
  registry.destroy()
  dom.destroy()
  underlay.remove()
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
})
