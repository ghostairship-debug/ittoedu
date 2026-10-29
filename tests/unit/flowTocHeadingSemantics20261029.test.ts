import { afterEach, expect, it } from 'vitest'
import { FlowRuntimeTocChrome, type FlowRuntimeTocEntry } from '../../src/player/surfaces/flow/flowRuntimeToc'

afterEach(() => document.body.replaceChildren())

it('announces authored heading levels without deriving them from directory indentation', () => {
  const root = document.createElement('main')
  document.body.append(root)
  const entries: FlowRuntimeTocEntry[] = [
    { kind: 'heading', surfaceId: 'flow', title: '二级标题', level: 0, headingLevel: 2, anchorId: 'h2' },
    { kind: 'heading', surfaceId: 'flow', title: '分节中的三级标题', level: 1, headingLevel: 3, anchorId: 'h3' },
    { kind: 'heading', surfaceId: 'flow', title: '旧导航目标', level: 2, anchorId: 'legacy' },
  ]
  const chrome = new FlowRuntimeTocChrome(root, { getEntries: () => entries, onNavigate() {} })
  try {
    const items = [...root.querySelectorAll<HTMLButtonElement>('[data-flow-runtime-toc-item]')]
    expect(items.map(item => item.getAttribute('aria-label'))).toEqual([
      '跳转到标题 2：二级标题', '跳转到标题 3：分节中的三级标题', '跳转到标题：旧导航目标',
    ])
    expect(items.map(item => item.style.paddingLeft)).toEqual(['8px', '20px', '32px'])
  } finally {
    chrome.destroy()
  }
})
