import { navigationCoverage } from '../behaviors/navigation/navigationControls'
import type { TeacherControllerAction } from '../../shared/contracts/component-platform'
import type { TeacherControllerDisplayPort } from '../../shared/teacherControllerViewportGeometry'
import { FlowRuntimeTocChrome, type FlowRuntimeTocEntry } from '../surfaces/flow/flowRuntimeToc'

/** V10 navigation supplies the titles and destinations; this chrome owns only its drawer. */
export function mountComponentFlowToc(root: HTMLElement, surfaceId: string, navigation: TeacherControllerDisplayPort,
  options: { initialOpen?: boolean; beforeNavigate?(): Promise<void>; onOpenChange?(open: boolean): void; onError?(message: string): void } = {}) {
  let entries: FlowRuntimeTocEntry[] = [], actions = new Map<string, TeacherControllerAction>(), signature = ''
  let visible=false,disposed=false,settled=false
  const grace=root.ownerDocument.defaultView!.setTimeout(()=>{settled=true;sync()},2000)
  const chrome = new FlowRuntimeTocChrome(root, {
    initialOpen: options.initialOpen,
    getEntries: () => entries,
    onOpenChange: options.onOpenChange,
    onNavigate: entry => { const action = actions.get(entry.anchorId); if (!action) return
      void (async () => { await options.beforeNavigate?.(); await navigation.execute?.(action); updateActive() })()
        .catch(error => options.onError?.(String(error))) },
  })
  const updateActive = () => {
    const reading = navigation.read().reading
    const active = reading?.containerId === surfaceId ? reading.activeInstanceId : null
    chrome.setActive(active && entries.some(entry => entry.anchorId === active) ? active : undefined)
  }
  const sync = () => {
    if(disposed)return
    const snapshot=navigation.read()
    const scene = snapshot.scenes.find(value => value.id === surfaceId)
    const targets = scene?.targets?.filter(value => value.kind === 'heading') ?? []
    const next = JSON.stringify(targets)
    if (signature !== next) {
      signature = next; actions = new Map(targets.map(target => [target.id, target.action]))
      entries = targets.map(target => ({ kind: 'heading', surfaceId, title: target.name, level: target.depth ?? 0,
        ...(target.headingLevel === undefined ? {} : { headingLevel: target.headingLevel }), anchorId: target.id, blockId: target.id }))
      chrome.sync()
    }
    const covered=navigationCoverage({...snapshot,locationId:surfaceId,reading:snapshot.reading??{containerId:surfaceId,activeInstanceId:null,progress:0}},navigation.readControls?.()??{actions:[]}).directory
    const nextVisible=settled&&entries.length>0&&!covered
    if(visible&&!nextVisible&&chrome.open)chrome.setOpen(false)
    visible=nextVisible;chrome.setVisible(visible)
    updateActive()
  }
  const off = navigation.subscribe(sync),offControls=navigation.subscribeControls?.(sync)
  root.addEventListener('scroll', updateActive, true)
  sync()
  return { sync, get open() { return visible && chrome.open },
    destroy() { disposed=true;root.ownerDocument.defaultView!.clearTimeout(grace);off();offControls?.(); root.removeEventListener('scroll', updateActive, true); chrome.destroy() } }
}
