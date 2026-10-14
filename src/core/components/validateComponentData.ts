import type { CourseProjectV10 } from '../../shared/contracts/component-platform'
import { componentDefinitionBuiltinKey } from '../../shared/contracts/component-platform'
import { textComponentDataSchema as textDataSchema, formulaComponentDataSchema as formulaDataSchema } from '../../components/text/data'
import { imageDataSchema } from '../../components/image/data'
import { shapeDataSchema } from '../../components/shape/data'
import { tableDataSchema } from '../../components/table/data'
import { chartDataSchema } from '../../components/chart/data'
import { webDataSchema } from '../../components/web/data'
import { audioDataSchema, videoDataSchema } from '../../components/media/data'
import { parseDocumentBlockData } from '../../components/document-block'

/** Actual default consumers share their professional parsers with the persisted writer. */
export function validateComponentData(project: CourseProjectV10): void {
  const validate = (instance: CourseProjectV10['instances'][string], data: unknown) => {
    const definition = project.definitions[instance.definitionId]
    const key = componentDefinitionBuiltinKey(definition)
    if (key === 'guoling.text') textDataSchema.parse(data)
    else if (key === 'guoling.formula') formulaDataSchema.parse(data)
    else if (key === 'guoling.image') imageDataSchema.parse(data)
    else if (key === 'guoling.shape') shapeDataSchema.parse(data)
    else if (key === 'guoling.table') tableDataSchema.parse(data)
    else if (key === 'guoling.chart') chartDataSchema.parse(data)
    else if (key === 'guoling.audio') audioDataSchema.parse(data)
    else if (key === 'guoling.video') videoDataSchema.parse(data)
    else if (key === 'guoling.document-block') parseDocumentBlockData(data, instance.id)
    else if (key === 'guoling.web' || key === 'guoling.html-program') webDataSchema.parse(data)
  }
  for (const instance of Object.values(project.instances)) validate(instance, instance.data)
  for (const surface of project.surfaces) for (const state of surface.presentation?.states ?? []) for (const [id, override] of Object.entries(state.overrides)) {
    if (override.data !== undefined && project.instances[id]) validate(project.instances[id], override.data)
  }
}
