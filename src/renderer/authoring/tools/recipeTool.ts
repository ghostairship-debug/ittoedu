import { z } from 'zod'
import { RECIPE_CATALOG } from '../../recipes/recipeCatalog'
import { planRecipe } from '../../recipes/applyRecipe'
import { resolveAuthoringToolScope } from './authoringToolScope'
import { slideStructureAddress } from './slideStructureTool'
import type { AuthoringToolDefinition } from './executeAuthoringTool'

const schema = z.object({ recipeId: z.enum(RECIPE_CATALOG.map(entry => entry.id)), slots: z.record(z.string(), z.string().max(1200)), accentTokenId: z.string().min(1).optional() }).strict()
export const recipeTool: AuthoringToolDefinition<z.infer<typeof schema>> = {
  name: 'recipe.apply', inputSchema: schema,
  description: '仅 Slide：scene owner + create parent:course-locations，insertion={kind:after,siblingId:当前locationId}。slots 只能用 对应 Recipe 能力卡中的 fields.key（从 capabilities/discovery.json 或 query.mjs 按 recipeId 读取）。配方会新建一页，返回位置可用 created-scope。',
  plan({ document, destination, value }) {
    const { target, surface } = resolveAuthoringToolScope(document, destination)
    if (surface.type !== 'slide' || target.owner !== 'scene' || destination.kind !== 'create' || destination.scope.parent.kind !== 'course-locations'
      || destination.scope.insertion.kind !== 'after' || destination.scope.insertion.siblingId !== target.locationId) throw new Error('配方需要在当前 Slide 位置之后创建页面')
    const allowed = new Set<string>(RECIPE_CATALOG.find(entry => entry.id === value.recipeId)!.fields.map(field => field.key))
    if (Object.keys(value.slots).some(key => !allowed.has(key))) throw new Error('配方包含未定义的内容槽位')
    const result = planRecipe(document, { ...value, target: { projectId: document.id, revision: document.revision, locationId: target.locationId, sessionGeneration: target.sessionGeneration } })
    if (!result.ok) throw new Error(result.reason)
    return { transaction: { ...result.plan, selectionHint: { kind: 'authoring-tool-selection', locationId: result.createdLocationId, stateId: null, owner: 'scene', itemIds: [] } },
      affected: [{ id: result.createdLocationId, operation: 'created', ownerKey: `scene:${result.createdLocationId}`, authoringAddress: slideStructureAddress(document.id, surface.id, result.createdLocationId, null) }] }
  },
}
