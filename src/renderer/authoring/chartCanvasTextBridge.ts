import type { CourseAuthoringTarget } from './courseAuthoringSession'
import type { SlideAuthoringTarget } from '../course/slideAuthoringBackend'

export type ChartCanvasTextKind = 'category' | 'series'
export interface ChartCanvasTextPort {
  read(kind: ChartCanvasTextKind, id: string): string | undefined
  /** Commits through the inspector's existing validated whole-table draft. */
  commit(kind: ChartCanvasTextKind, id: string, value: string): string | null
}

// Only a connection to the mounted inspector; draft data stays in its owner.
// No document, history or second draft is stored here.
const connections = new Map<string, ChartCanvasTextPort>()
function key(target: SlideAuthoringTarget | CourseAuthoringTarget): string {
  if ('documentRevision' in target) {
    // Canvas targets frame while the inspector targets item; both edit the same chart draft.
    return JSON.stringify([target.projectId, target.sessionGeneration, target.documentRevision, target.surfaceType, target.surfaceId, target.locationId, target.stateId, target.owner, target.ownerKey, target.itemId])
  }
  return `${target.sessionId}:${target.generation}:${target.revision}:${target.authoringAddress}`
}
export function connectChartCanvasText(target: SlideAuthoringTarget | CourseAuthoringTarget, port: ChartCanvasTextPort): () => void {
  const address = key(target)
  connections.set(address, port)
  return () => { if (connections.get(address) === port) connections.delete(address) }
}
export function chartCanvasTextPort(target: SlideAuthoringTarget | CourseAuthoringTarget): ChartCanvasTextPort | undefined {
  return connections.get(key(target))
}
