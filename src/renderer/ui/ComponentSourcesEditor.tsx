import { useSyncExternalStore } from 'react'
import type { ComponentInstance } from '../../shared/contracts/component-platform'
import type { CourseV10DocumentBridge } from '../documents/CourseV10DocumentBridge'
import { ComponentSourceEditor } from '../components/ComponentSourceEditor'

/** The shared source entry edits the formal definition/files, never a V4 package projection. */
export function ComponentSourcesEditor({ instance, bridge, documentId, report }: {
  instance?: ComponentInstance; bridge: CourseV10DocumentBridge; documentId: string; report(message: string): void
}) {
  const view = useSyncExternalStore(bridge.subscribe, bridge.read)
  const project = view.views.find(item => item.documentId === documentId)?.model.project
  const definition = instance && project?.definitions[instance.definitionId]
  const count = Object.values(project?.instances ?? {}).filter(value => value.definitionId === definition?.id && !value.implementationOverride).length
  return <section className="developer-card component-source-editor">
    {definition && <p>共享定义 · {count} 个继承实例{definition.version ? ` · ${definition.version}` : ''}；有独立实现的实例保持独立。</p>}
    <ComponentSourceEditor scope="definition" instance={instance} implementation={definition?.implementation}
      bridge={bridge} documentId={documentId} report={report} />
  </section>
}
