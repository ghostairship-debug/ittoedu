import { visitProjectDynamicInstances } from '../../shared/composition/dynamic'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { DocumentResources } from '../../shared/workbench/document'
import { documentDigest } from '../documents/documentDigest'

// A valid 1×1 PNG; admission replaces it with the real capture, as the HTML importer does.
const PLACEHOLDER_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='), char => char.charCodeAt(0))

/** Running code that is new or whose definition changed; layout, captures and disabled drafts need no admission. */
export function programsChanged(before: CourseProjectDocument, after: CourseProjectDocument): boolean {
  const programs = (project: CourseProjectDocument) => {
    const found = new Map<string, string>()
    visitProjectDynamicInstances(project, entry => {
      if (entry.kind !== 'runtime' || !entry.runtime.enabled) return
      const { staticFallback: _fallback, ...code } = entry.runtime
      found.set(entry.instanceId, documentDigest(code))
    })
    return found
  }
  const prior = programs(before)
  return [...programs(after)].some(([id, digest]) => prior.get(id) !== digest)
}

/** Admission captures into a declared fallback; a new program declares a placeholder first (in place). */
export function withProgramFallbacks(project: CourseProjectDocument, resources: DocumentResources): DocumentResources {
  let next = resources
  visitProjectDynamicInstances(project, entry => {
    if (entry.kind !== 'runtime' || !entry.runtime.enabled || entry.runtime.staticFallback) return
    const base = `runtime-capture-${entry.instanceId.replace(/[^A-Za-z0-9_.-]+/g, '-')}`
    let assetId = base
    for (let suffix = 2; project.assets[assetId] || next.assets[assetId]; suffix++) assetId = `${base}-${suffix}`
    project.assets[assetId] = { id: assetId, filename: `${assetId}.png`, mimeType: 'image/png', kind: 'image', path: `assets/${assetId}.png`,
      byteLength: PLACEHOLDER_PNG.byteLength, width: 1, height: 1 }
    next = { ...next, assets: { ...next.assets, [assetId]: Uint8Array.from(PLACEHOLDER_PNG) } }
    entry.runtime.staticFallback = { assetId, coverage: entry.composition ? 'surface' : 'scene' }
  })
  return next
}
