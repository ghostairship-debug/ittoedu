import type { CourseProjectV10 } from '../../shared/contracts/component-platform'
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
  for (const instance of Object.values(project.instances)) {
    const definition = project.definitions[instance.definitionId]
    const key = definition?.implementation.kind === 'builtin' ? definition.implementation.key : definition?.id
    if (key === 'guoling.text') textDataSchema.parse(instance.data)
    else if (key === 'guoling.formula') formulaDataSchema.parse(instance.data)
    else if (key === 'guoling.image') imageDataSchema.parse(instance.data)
    else if (key === 'guoling.shape') shapeDataSchema.parse(instance.data)
    else if (key === 'guoling.table') tableDataSchema.parse(instance.data)
    else if (key === 'guoling.chart') chartDataSchema.parse(instance.data)
    else if (key === 'guoling.audio') audioDataSchema.parse(instance.data)
    else if (key === 'guoling.video') videoDataSchema.parse(instance.data)
    else if (key === 'guoling.document-block') parseDocumentBlockData(instance.data, instance.id)
    else if (key === 'guoling.web' || key === 'guoling.html-program') webDataSchema.parse(instance.data)
  }
}
