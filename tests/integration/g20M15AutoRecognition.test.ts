import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { RuntimeAuthoringTargetRegistry } from '@/player/RuntimeAuthoringTargetRegistry'
import { DomTextOverrides } from '@/player/lightEdit/domTextOverrides'
import { PhaserTextOverrides } from '@/player/lightEdit/phaserTextOverrides'
import { scanPageText } from '@/shared/runtimeText/scanPageText'
import type { RuntimeAuthoringTarget } from '@/shared/runtimeTypes'

// M15-T02: the host recognises what a Runtime shows without any registration; what it cannot read stays AI-only.
const root = resolve(__dirname, '../..')
const rect = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) }) as DOMRect
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }
afterEach(() => { Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect'); document.body.replaceChildren(); vi.restoreAllMocks() })

it('M15 Phaser Text and static Images are targets; canvas and WebGL drawing and program-computed text are not', async () => {
  class FakeText {
    active = true; visible = true; _text = ''
    constructor(value: string, private readonly box: { x: number; y: number; width: number; height: number }) { this.setText(value) }
    get text() { return this._text }
    set text(value: string) { this.setText(value) }
    setText(value: string | string[]) { this._text = Array.isArray(value) ? value.join('\n') : String(value); return this }
    getBounds() { return this.box }
  }
  const title = new FakeText('开始挑战', { x: 20, y: 20, width: 200, height: 40 })
  const score = new FakeText('120', { x: 20, y: 80, width: 60, height: 30 })
  const engine = new PhaserTextOverrides(() => [title, score] as never, (object): object is never => object instanceof FakeText, [])
  engine.scan()
  const picture = { active: true, visible: true, texture: { source: [{ image: { src: 'blob:hero' } }] }, getBounds: () => ({ x: 300, y: 40, width: 160, height: 90 }) }
  const unknownPicture = { active: true, visible: true, texture: { source: [{ image: { src: 'blob:elsewhere' } }] }, getBounds: () => ({ x: 0, y: 0, width: 10, height: 10 }) }
  // The DOM layer of a hybrid Runtime: one heading, and a canvas the Runtime draws on (2D or WebGL): no text nodes.
  const overlay = document.createElement('div'), underlay = document.createElement('div')
  overlay.innerHTML = '<h2>第一关</h2><canvas width="320" height="180"></canvas>'
  document.body.append(underlay, overlay)
  overlay.getBoundingClientRect = () => rect(0, 0, 640, 360)
  underlay.getBoundingClientRect = () => rect(0, 0, 640, 360)
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect(20, 10, 80, 24) })
  const dom = new DomTextOverrides([underlay, overlay], [])
  const updates: RuntimeAuthoringTarget[][] = []
  const registry = new RuntimeAuthoringTargetRegistry({
    scope: 'scene', sceneId: 'scene-1', width: 640, height: 360, canvas: { width: 1280, height: 720 },
    content: { values: {} }, assets: { hero: { assetId: 'asset-hero' } },
    domRoots: { underlay, overlay },
    lightEdit: { dom, phaser: engine, assetKeyForUrl: url => url === 'blob:hero' ? 'hero' : undefined,
      phaserImages: () => [picture, unknownPicture] as never, phaserLayerOf: () => 'overlay' },
    onTargetsChanged: update => updates.push([...update.targets]),
  })
  await settle()
  const targets = updates.at(-1)!
  expect(targets.map(target => [target.kind, target.source, target.lightEdit?.original ?? target.key])).toEqual([
    ['text', 'auto', '第一关'],
    ['text', 'auto', '开始挑战'],
    ['asset', 'auto', 'hero'],
  ])
  expect(targets.find(target => target.lightEdit?.original === '开始挑战')).toMatchObject({ lightEdit: { region: 'phaser' }, bounds: { x: 40, y: 40, width: 400, height: 80 } })
  // The score (program-computed) and the canvas drawing have no target; a picture of no project asset has none either.
  expect(targets.some(target => target.lightEdit?.original === '120')).toBe(false)
  registry.destroy(); dom.destroy(); engine.destroy()
})

it('M15 the page-text list reads a bundled page with no static text, including text of states not shown yet', () => {
  // A React-style bundle: the HTML has only a mount point; the words live in the script, some only in later states.
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>x</title></head><body><div id="root"></div><script src="app.js"></script></body></html>'
  const bundle = 'import{useState as u}from"react";import{jsx as j,jsxs as k}from"react/jsx-runtime";'
    + 'function A(){const[s,t]=u(0);return k("main",{className:"quiz-panel",children:[j("h1",{children:"听力练习"}),'
    + 's===0?j("button",{onClick:()=>t(1),children:"播放录音"}):s===1?j("p",{children:"请选出你听到的图片"}):j("p",{children:"答对了，真棒！"}),'
    + 'j("img",{alt:"小猫在睡觉",src:"assets/cat.png"})]})}export default A;'
  const result = scanPageText([{ path: 'index.html', kind: 'html', text: html }, { path: 'app.js', kind: 'js', text: bundle }])
  const texts = result.entries.map(entry => entry.text)
  expect(texts).toEqual(expect.arrayContaining(['听力练习', '播放录音', '请选出你听到的图片', '答对了，真棒！', '小猫在睡觉']))
  // Code, not copy: class names, module names and file paths are left out.
  expect(texts).not.toEqual(expect.arrayContaining(['quiz-panel']))
  expect(texts.some(text => text.includes('react') || text.includes('assets/'))).toBe(false)
})

it('M15 current API 5 creation and editing guides leave visible text and image identity to the host', () => {
  const guide = (file: string) => readFileSync(join(root, 'artifacts/ai-capabilities/skills', file), 'utf8')
  const html = guide('build-courseware-project/references/html-draft-contract.md')
  const edit = guide('edit-content/SKILL.md')
  const representation = guide('build-courseware-project/references/representation-capabilities.md')
  expect(html).toContain('不要求私有模板、登记表或编辑编号')
  expect(html).toContain('软件解析、包装并管理资源')
  expect(html).toContain('文字和图片的轻编辑能力')
  expect(edit).toContain('宿主维护目标身份、关联资源、事务和应用结果')
  expect(edit).toContain('不手工登记对象、修订号或资源编号')
  expect(representation).toContain('软件登记身份')
  for (const text of [html, edit, representation]) {
    for (const requirement of ['必须来自 `content.values`', '所有人工可见文字都来自 `content.values`',
      '所有组件文字必须放入 `props.content`', '必须显式登记命中区域', '组件必须通过 DOM `data-courseware-edit-key`',
      '所有可达状态的可见文案都必须出现在有效 `props.content` 中']) expect(text).not.toContain(requirement)
  }
  const protocol = JSON.parse(readFileSync(join(root, 'artifacts/ai-capabilities/protocols/component-api5.json'), 'utf8'))
  expect(protocol.apiVersion).toBe(5)
})
