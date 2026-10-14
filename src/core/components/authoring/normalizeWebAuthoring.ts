import { componentDefinitionBuiltinKey, type CourseProjectV10, type JsonValue } from '../../../shared/contracts/component-platform/project'
import { componentAuthorRecordsSchema } from '../../../shared/contracts/component-platform/schema'

/** Adopt the known Web author's previous record placement once when opening an archive.
 * Arbitrary Source business data is never interpreted as host metadata. */
export function normalizeWebAuthoring(project: CourseProjectV10): CourseProjectV10 {
  const next = structuredClone(project)
  for (const instance of Object.values(next.instances)) {
    const key = componentDefinitionBuiltinKey(next.definitions[instance.definitionId])
    if (key !== 'guoling.web' && key !== 'guoling.html-program') continue
    const data = instance.data
    const canonical = instance.authoring !== undefined
    const legacy = !!data && typeof data === 'object' && !Array.isArray(data) && Object.hasOwn(data, 'authoringRecords')
    const adopt = (value: JsonValue) => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'authoringRecords')) return undefined
      const records = componentAuthorRecordsSchema.parse(value.authoringRecords)
      delete value.authoringRecords
      return { records }
    }
    const authoring = adopt(data)
    if (authoring && instance.authoring === undefined) instance.authoring = authoring
    for (const surface of next.surfaces) for (const state of surface.presentation?.states ?? []) {
      const override = state.overrides[instance.id]
      if (override?.data === undefined) continue
      const authoring = adopt(override.data)
      // The old state replaced all Web data. Absence of records was an explicit empty state.
      if (override.authoring === undefined && (authoring || legacy || !canonical)) override.authoring = authoring ?? {}
    }
  }
  return next
}
