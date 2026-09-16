import { materialRecordV1Schema, materialCitationText } from '../../../shared/materialContract'
import type { AuthoringToolDefinition } from './executeAuthoringTool'
import type { MaterialRecordV1 } from '../../../shared/materialContract'
import { nativeAuthoringTool, nativeAuthoringToolInputSchema } from './nativeAuthoringTool'
import { flowAuthoringTool, flowAuthoringToolInputSchema } from './flowAuthoringTool'

export const materialCitationTool: AuthoringToolDefinition<MaterialRecordV1> = {
  name: 'material.citation', inputSchema: materialRecordV1Schema,
  plan({ document, destination, value }) {
    if (value.workspace.projectId !== document.id) throw new Error('材料不属于当前工程')
    if (destination.kind !== 'create') throw new Error('材料引用需要明确插入位置')
    const text = materialCitationText(value)
    if (destination.scope.parent.kind === 'flow-body') {
      return flowAuthoringTool.plan({ document, destination,
        value: flowAuthoringToolInputSchema.parse({ operation: 'insert', block: { type: 'paragraph', content: { inlines: [{ type: 'text', text }] } } }) })
    }
    return nativeAuthoringTool.plan({ document, destination,
      value: nativeAuthoringToolInputSchema.parse({ operation: 'insert', template: { nativeType: 'text', text, label: value.title } }) })
  },
}
