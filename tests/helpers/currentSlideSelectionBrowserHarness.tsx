import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { NodesTab } from '../../src/renderer/ui/NodesTab'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import { mountCurrentCourseBrowserHarness } from './currentFlowBrowserHarness'

/** Real workspace and Nodes UI, sharing the same application store and Bridge. */
export async function mountSlideSelectionBrowserHarness(host: HTMLElement, nodes: HTMLElement, api: DocumentHostAPI) {
  const course = await mountCurrentCourseBrowserHarness(host, api)
  const root = createRoot(nodes)
  flushSync(() => root.render(<NodesTab />))
  return { ...course, get runtime() { return course.runtime }, async dispose() {
    flushSync(() => root.unmount()); await course.dispose()
  } }
}

export { useEditorStore } from './currentFlowBrowserHarness'
