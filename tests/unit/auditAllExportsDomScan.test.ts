import { afterEach, expect, it, vi } from 'vitest'
import { createDomAuthoring } from '../../src/components/web/authoringDom'
import type { ComponentAuthorRecord } from '../../src/shared/contracts/component-platform'

afterEach(() => vi.restoreAllMocks())

it('CA336: unique same-tag text scans reuse path/scope/value indexes with linear value reads on both first and repeated scans', () => {
  const counts: number[][] = []
  for (const count of [100, 400]) {
    const root = document.createElement('div'); root.innerHTML = Array.from({ length: count }, (_, index) => `<p>唯一正文 ${index}</p>`).join('')
    document.body.append(root)
    let records: Record<string, ComponentAuthorRecord> = {}
    const adapter = createDomAuthoring(root, { records: () => records })
    const reads = vi.spyOn(Node.prototype, 'nodeValue', 'get')
    try {
      const first = adapter.scan()
      expect(first).toHaveLength(count)
      expect(first.every(value => value.bindingStatus === 'bound')).toBe(true)
      const firstCount = reads.mock.calls.length
      records = Object.fromEntries(first.map(value => [value.authorKey, value.record]))
      reads.mockClear()
      const repeated = adapter.scan()
      expect(repeated.every(value => value.bindingStatus === 'bound')).toBe(true)
      expect(repeated.map(value => value.authorKey)).toEqual(first.map(value => value.authorKey))
      counts.push([firstCount, reads.mock.calls.length])
      expect(firstCount).toBeLessThan(count * 20)
      expect(reads.mock.calls.length).toBeLessThan(count * 40)
    } finally { adapter.dispose(); root.remove(); reads.mockRestore() }
  }
  expect(counts[1]![0]! / counts[0]![0]!).toBeLessThan(5)
  expect(counts[1]![1]! / counts[0]![1]!).toBeLessThan(5)
})

it('CA336: ephemeral indexes keep unique rebinds after reorder and preserve ambiguous duplicate baselines', () => {
  const root = document.createElement('div'); root.innerHTML = '<p>甲</p><p>乙</p>'; document.body.append(root)
  let records: Record<string, ComponentAuthorRecord> = {}
  const adapter = createDomAuthoring(root, { records: () => records })
  try {
    const initial = adapter.scan()
    const original = initial.find(value => value.initialValue === '甲')!
    records = { [original.authorKey]: { ...original.record, overrides: { text: '甲的人工修改' } } }
    root.innerHTML = '<p>乙</p><p>甲</p>'
    const rebound = adapter.scan().find(value => value.authorKey === original.authorKey)!
    expect(rebound.bindingStatus).toBe('bound')
    expect(root.lastElementChild!.textContent).toBe('甲的人工修改')
    expect(root.firstElementChild!.textContent).toBe('乙')
    records = {}
    root.innerHTML = '<p>相同</p><p>相同</p>'
    expect(adapter.scan().every(value => value.bindingStatus === 'unresolved')).toBe(true)
  } finally { adapter.dispose(); root.remove() }
})
