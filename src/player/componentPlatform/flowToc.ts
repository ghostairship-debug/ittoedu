import type { TeacherControllerAction } from '../../shared/contracts/component-platform'
import type { TeacherControllerDisplayPort } from '../../shared/teacherControllerViewportGeometry'
import { FlowRuntimeTocChrome, type FlowRuntimeTocEntry } from '../surfaces/flow/flowRuntimeToc'

/** V10 navigation supplies the titles and destinations; this chrome owns only its drawer. */
export function mountComponentFlowToc(root: HTMLElement, surfaceId: string, navigation: TeacherControllerDisplayPort,
  options: { initialOpen?: boolean; beforeNavigate?(): Promise<void>; onError?(message: string): void } = {}) {
  let entries: FlowRuntimeTocEntry[] = [], actions = new Map<string, TeacherControllerAction>(), signature = ''
  const chrome = new FlowRuntimeTocChrome(root, {
    initialOpen: options.initialOpen,
    getEntries: () => entries,
    onNavigate: entry => { const action = actions.get(entry.anchorId); if (!action) return
      void (async () => { await options.beforeNavigate?.(); await navigation.execute?.(action); updateActive() })()
        .catch(error => options.onError?.(String(error))) },
  })
  const updateActive = () => {
    const top = root.getBoundingClientRect().top + 80
    const scroll = root.querySelector<HTMLElement>('[data-flow-paper-scroll]')
    const atEnd = scroll && scroll.scrollTop > 0 && scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2
    let active = entries[0]?.anchorId
    for (const entry of entries) {
      const node = entry.blockId && root.querySelector<HTMLElement>(`[data-flow-block-id="${CSS.escape(entry.blockId)}"], [data-component-object="${CSS.escape(entry.blockId)}"]`)
      if (node && node.getBoundingClientRect().height > 0 && (node.getBoundingClientRect().top <= top
        || atEnd && node.getBoundingClientRect().top < scroll.getBoundingClientRect().bottom)) active = entry.anchorId
    }
    chrome.setActive(active)
  }
  const sync = () => {
    const scene = navigation.read().scenes.find(value => value.id === surfaceId)
    const targets = scene?.targets?.filter(value => value.kind === 'heading') ?? []
    const next = JSON.stringify(targets)
    if (signature !== next) {
      signature = next; actions = new Map(targets.map(target => [target.id, target.action]))
      entries = targets.map(target => ({ kind: 'heading', surfaceId, title: target.name, level: target.depth ?? 0, anchorId: target.id, blockId: target.id }))
      chrome.sync()
    }
    chrome.setVisible(entries.length > 0)
    updateActive()
  }
  const off = navigation.subscribe(sync)
  root.addEventListener('scroll', updateActive, true)
  sync()
  return { sync, destroy() { off(); root.removeEventListener('scroll', updateActive, true); chrome.destroy() } }
}
