import { nanoid } from 'nanoid'
import { materialRecordV1Schema, materialCitationText } from '../../../shared/materialContract'
import { createTextComponentData } from '../../../components/text/data'
import { TEXT_DEFINITION } from '../../../components/text/adapters'
import type { EditorStoreKernel } from '../../store/editorStoreKernel'
import type { MaterialCitationRequest } from './materialCitationRequest'
import { commitCourseInsertion, courseAuthorData } from '../../media/commitCourseMediaAuthoring'

export async function insertMaterialCitation(kernel: EditorStoreKernel, request: MaterialCitationRequest) {
  const material = materialRecordV1Schema.parse(request.material), target = request.target
  if (material.workspace.projectId !== target.project.id) throw new Error('材料不属于捕获的原工程')
  const id = `material_${nanoid()}`, instanceId = `instance_${nanoid()}`
  const bytes = new TextEncoder().encode(JSON.stringify(material))
  const surface = target.project.surfaces.find(value => value.id === target.surfaceId)
  const instance = { id: instanceId, definitionId: TEXT_DEFINITION.id, name: material.title,
    data: courseAuthorData(createTextComponentData(materialCitationText(material))),
    ...(surface?.kind === 'flow' ? {} : { frame: { width: 600, height: 280, transform: [1, 0, 0, 1, 80, 80] as [number, number, number, number, number, number] } }) }
  const result = await commitCourseInsertion(kernel, target, TEXT_DEFINITION, [instance], {},
    [{ type: 'asset.add', asset: { id, path: `materials/${id}.json`, mimeType: 'application/json' }, bytes }])
  return { ...result, status: 'committed' as const, assetId: id, diagnostics: [] }
}
/** This local entry executes the same real canonical transaction as the original UI. */
export const materialCitationTool = { name: 'material.citation' as const, inputSchema: materialRecordV1Schema, execute: insertMaterialCitation }
