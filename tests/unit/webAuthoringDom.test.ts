import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { createDomAuthoring } from '@/components/web/authoringDom'
import type { ComponentAuthorRecord } from '@/shared/contracts/component-platform/runtime'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); document.body.replaceChildren() })
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

describe('persistent local DOM authoring', () => {
  it('keeps keyed duplicate React text and image edits through state changes, reorder, undo and a cold mount', async () => {
    let records: Record<string, ComponentAuthorRecord> = {}
    const container = document.createElement('div'); document.body.append(container)
    const Item = ({ item }: { item: { id: string } }) => createElement('article', null,
      createElement('p', null, 'Same text'), createElement('img', { src: 'original.png' }))
    const View = ({ conversation, reverse = false }: { conversation: { id: string }; reverse?: boolean }) => createElement('section', null,
      (reverse ? ['b', 'a'] : ['a', 'b']).map(id => createElement(Item, { key: id, item: { id: `${conversation.id}/${id}` } })))
    let react: Root = createRoot(container)
    const render = (id: string, reverse = false) => flushSync(() => react.render(createElement(View, { conversation: { id }, reverse })))
    render('conversation-1')
    let consumer = createDomAuthoring(container, { records: () => records, resolveResource: ref => ref === 'cw-resource:new' ? 'new.png' : ref })
    cleanups.push(() => { consumer.dispose(); flushSync(() => react.unmount()) })
    const text = consumer.scan().find(value => value.node === container.querySelector('article:last-child p')!.firstChild)!
    const image = consumer.scan().find(value => value.node === container.querySelector('article:last-child img'))!
    expect(text.record.scope).toMatchObject({ 'react:conversation.id': 'conversation-1', 'react:item.id': 'conversation-1/b' })
    records = {
      [text.authorKey]: { ...text.record, overrides: { text: 'Changed only B' } },
      [image.authorKey]: { ...image.record, overrides: { src: 'cw-resource:new' } },
    }
    consumer.refresh()
    expect([...container.querySelectorAll('p')].map(node => node.textContent)).toEqual(['Same text', 'Changed only B'])
    expect([...container.querySelectorAll('img')].map(node => node.getAttribute('src'))).toEqual(['original.png', 'new.png'])
    render('conversation-2'); await flush()
    expect([...container.querySelectorAll('p')].map(node => node.textContent)).toEqual(['Same text', 'Same text'])
    render('conversation-1', true); await flush()
    expect([...container.querySelectorAll('p')].map(node => node.textContent)).toEqual(['Changed only B', 'Same text'])
    expect([...container.querySelectorAll('img')].map(node => node.getAttribute('src'))).toEqual(['new.png', 'original.png'])
    const saved = JSON.parse(JSON.stringify(records))
    records = {}; consumer.refresh()
    expect([...container.querySelectorAll('p')].map(node => node.textContent)).toEqual(['Same text', 'Same text'])
    records = saved; consumer.refresh()
    expect(container.querySelector('p')!.textContent).toBe('Changed only B')
    consumer.dispose(); flushSync(() => react.unmount()); react = createRoot(container)
    render('conversation-1', true)
    // No scanner/editor callback is installed in this read-only consumer.
    consumer = createDomAuthoring(container, { records: () => records, resolveResource: ref => ref === 'cw-resource:new' ? 'new.png' : ref })
    expect(container.querySelector('p')!.textContent).toBe('Changed only B')
    expect(container.querySelector('img')!.getAttribute('src')).toBe('new.png')
  })

  it('restores responsive images and local styles, applies updated effective values, and diagnoses missing content', async () => {
    const root = document.createElement('div'); document.body.append(root)
    root.innerHTML = '<p id="title" style="transform:rotate(5deg)">Before</p><picture><source srcset="wide.png 2x"><img src="small.png" srcset="small.png 1x"></picture>'
    let records: Record<string, ComponentAuthorRecord> = {}
    const statuses: string[] = []
    const consumer = createDomAuthoring(root, { records: () => records, report: (key, status) => statuses.push(`${key}:${status}`) })
    cleanups.push(() => consumer.dispose())
    const [text, image] = consumer.scan()
    records = {
      [text!.authorKey]: { ...text!.record, overrides: { text: 'After', geometry: { translateX: 25, width: 120 } } },
      [image!.authorKey]: { ...image!.record, overrides: { src: 'changed.png' } },
    }
    consumer.refresh(); await flush()
    expect(root.querySelector('p')!.textContent).toBe('After')
    expect(root.querySelector('p')!.style.transform).toBe('rotate(5deg)')
    expect(root.querySelector('p')!.style.width).toBe('120px')
    expect(root.querySelector('img')!.getAttribute('srcset')).toBeNull()
    expect(root.querySelector('source')!.getAttribute('srcset')).toBeNull()
    records[text!.authorKey] = { ...records[text!.authorKey]!, overrides: { ...records[text!.authorKey]!.overrides, text: 'AI continued' } }
    consumer.refresh()
    expect(root.querySelector('p')!.textContent).toBe('AI continued')
    root.querySelector('p')!.firstChild!.nodeValue = 'Other program state'; await flush()
    expect(root.querySelector('p')!.textContent).toBe('Other program state')
    expect(statuses.at(-1)).toBe(`${text!.authorKey}:unresolved`)
    records = {}; consumer.refresh()
    expect(root.querySelector('p')!.style.width).toBe('')
    expect(root.querySelector('img')!.getAttribute('src')).toBe('small.png')
    expect(root.querySelector('img')!.getAttribute('srcset')).toBe('small.png 1x')
    expect(root.querySelector('source')!.getAttribute('srcset')).toBe('wide.png 2x')
  })
})
