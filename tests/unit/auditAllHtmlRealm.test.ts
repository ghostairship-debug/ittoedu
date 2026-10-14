import { describe, expect, it } from 'vitest'
import { mountWebContent } from '../../src/components/web/contentRealmImplementation'

const textOwner = () => ({ setRules() {}, applyAll() {}, destroy() {}, samples: () => [], originalText: () => undefined, setLocalText() {} })
function context(root: HTMLElement, instance: any) {
  const abort = new AbortController()
  return { root, instance, scope: { signal: abort.signal, isActive: () => true, cleanup() {}, events: { emit() {} } } } as any
}
describe('R51 incremental Web runtime state', () => {
  it('CA176 applies only changed author properties while preserving running document styles', async () => {
    const saved = document.body.style.cssText
    document.body.style.cssText = 'color:red; padding:12px'
    const instance = { id: 'document', definitionId: 'guoling.html-program', data: { html: '<body style="color:red; padding:12px">正文</body>', css: 'body{background:white}' } }
    const mounted = await mountWebContent(context(document.body, instance), undefined, true, textOwner as any)
    try {
      document.body.style.color = 'blue'
      document.body.style.setProperty('--program-state', 'running')
      const style = [...document.head.querySelectorAll('style')].find(node => node.textContent === instance.data.css)!
      style.sheet!.insertRule('body{outline:1px solid green}')
      await mounted.update({ ...instance, data: { ...instance.data, textOverrides: [{ key: 'paragraph', text: '改字' }] } } as any)
      expect(document.body.style.color).toBe('blue')
      expect(document.body.style.getPropertyValue('--program-state')).toBe('running')
      expect(style.sheet!.cssRules).toHaveLength(2)
      await mounted.update({ ...instance, style: { borderColor: 'black' } } as any)
      expect(document.body.style.color).toBe('blue'); expect(document.body.style.borderColor).toBe('black')
      await mounted.update({ ...instance, style: { color: 'green' } } as any)
      expect(document.body.style.color).toBe('green'); expect(document.body.style.borderColor).toBe('')
    } finally { mounted.dispose(); document.body.style.cssText = saved }
  })
  it('CA176 keeps a measured fragment program style during unrelated data and placement updates', async () => {
    const root = document.createElement('div'); document.body.append(root)
    const instance = { id: 'fragment', definitionId: 'guoling.web', frame: { width: 640, height: 360 }, style: { width: '640px', height: '360px' },
      data: { html: '<div style="width:640px;height:360px;color:red">正文</div>' } }
    const mounted = await mountWebContent(context(root, instance), undefined, false, textOwner as any)
    try {
      const element = root.firstElementChild as HTMLElement
      element.style.color = 'blue'
      await mounted.update({ ...instance, data: { ...instance.data, textOverrides: [] } } as any)
      mounted.updatePlacement({ ...instance.frame, width: 800 } as any)
      expect(element.style.color).toBe('blue'); expect(root.style.width).toBe('800px')
    } finally { mounted.dispose(); root.remove() }
  })
})
