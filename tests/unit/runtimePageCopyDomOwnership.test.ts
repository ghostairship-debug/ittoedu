import { afterEach, expect, it } from 'vitest'
import { createDomAuthoring } from '@/components/web/authoringDom'
import { DomTextOverrides } from '@/player/lightEdit/domTextOverrides'
import type { ComponentAuthorRecord } from '@/shared/contracts/component-platform/runtime'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); document.body.replaceChildren() })
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }

it('keeps precise author identity and layout while global copy changes, undoes and the program advances', async () => {
  const root = document.createElement('section'); document.body.append(root)
  root.innerHTML = '<p id="first">同一文字</p><p id="second">同一文字</p>'
  const first = root.querySelector<HTMLParagraphElement>('#first')!, second = root.querySelector('#second')!
  const scanner = createDomAuthoring(root, { records: () => ({}) })
  const original = scanner.describe(first.firstChild!)!
  scanner.dispose()
  const saved: ComponentAuthorRecord = { ...original.record,
    overrides: { text: '精确局部', geometry: { translateX: 12 }, style: { color: 'rgb(20, 30, 40)' } } }
  let records = { [original.authorKey]: saved }
  const page = new DomTextOverrides([root], [{ original: '同一文字', text: '全局修改' }])
  page.applyAll(); cleanups.push(() => page.destroy())
  const author = createDomAuthoring(root, { records: () => records,
    originalText: node => page.originalText(node), claimText: (node, text) => page.setLocalText(node, text) })
  cleanups.push(() => author.dispose())
  await settle()
  const bound = author.describe(first.firstChild!)!
  expect(bound.authorKey).toBe(original.authorKey)
  expect(bound.bindingStatus).toBe('bound')
  expect(bound.initialValue).toBe('精确局部')
  expect([first.textContent, second.textContent]).toEqual(['精确局部', '全局修改'])
  expect(first.style.translate).toContain('12px')
  expect(first.style.color).toBe('rgb(20, 30, 40)')
  expect(page.originalText(first.firstChild as Text)).toBe('同一文字')
  page.setRules([]); await settle()
  expect([first.textContent, second.textContent]).toEqual(['精确局部', '同一文字'])
  page.setRules([{ original: '同一文字', text: '全局重做' }]); await settle()
  expect([first.textContent, second.textContent]).toEqual(['精确局部', '全局重做'])
  records = {}; author.refresh(); await settle()
  expect(first.textContent).toBe('全局重做')
  expect(first.style.translate).toBe('')
  records = { [original.authorKey]: saved }; author.refresh(); await settle()
  expect(first.textContent).toBe('精确局部')
  ;(first.firstChild as Text).nodeValue = '程序进入新的状态'
  await settle()
  expect(first.textContent).toBe('程序进入新的状态')
  expect(author.describe(first.firstChild!)!.bindingStatus).toBe('unresolved')
  expect(page.originalText(first.firstChild as Text)).toBe('程序进入新的状态')
  expect(records[original.authorKey]).toBe(saved)
})

it('keeps the original image identity when resource URLs and formal references are both mapped', () => {
  const root = document.createElement('section'); document.body.append(root)
  root.innerHTML = '<img id="picture" src="blob:original">'
  let records: Record<string, ComponentAuthorRecord> = {}
  const consumer = createDomAuthoring(root, { records: () => records,
    resolveResource: reference => ({ 'cw-resource:original': 'blob:original', 'cw-resource:changed': 'blob:changed' })[reference],
    resourceReference: url => ({ 'blob:original': 'cw-resource:original', 'blob:changed': 'cw-resource:changed' })[url] })
  cleanups.push(() => consumer.dispose())
  const image = root.querySelector('img')!, original = consumer.describe(image)!
  expect(original.record.binding.baseline).toBe('cw-resource:original')
  records = { [original.authorKey]: { ...original.record, overrides: { src: 'cw-resource:changed' } } }
  consumer.refresh()
  const applied = consumer.describe(image)!
  expect(applied.authorKey).toBe(original.authorKey)
  expect(applied.bindingStatus).toBe('bound')
  expect(applied.initialValue).toBe('cw-resource:changed')
  expect(image.getAttribute('src')).toBe('blob:changed')
  records = {}; consumer.refresh()
  expect(image.getAttribute('src')).toBe('blob:original')
  expect(consumer.describe(image)!.authorKey).toBe(original.authorKey)
})
