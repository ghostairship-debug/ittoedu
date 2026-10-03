import { z } from 'zod'
import { makeAuthoringAddress } from '../../../shared/authoringAddress'
import { planProjectFontImport } from '../../course/projectFontImport'
import { resolveAuthoringToolScope } from './authoringToolScope'
import type { AuthoringToolDefinition } from './executeAuthoringTool'

const schema = z.object({ filename: z.string().min(1),
  base64: z.string().min(1).regex(/^[A-Za-z0-9+/]*={0,2}$/).refine(value => value.length % 4 === 0, 'Base64 字符数必须为 4 的倍数'),
}).strict()
export const fontAssetTool: AuthoringToolDefinition<z.infer<typeof schema>> = {
  name: 'asset.font.import', inputSchema: schema,
  async plan({ document, destination, value }) {
    const { target } = resolveAuthoringToolScope(document, destination)
    if (target.owner !== 'global' || destination.kind !== 'create' || destination.scope.parent.kind !== 'owner' || destination.scope.insertion.kind !== 'append') throw new Error('字体导入需要 global owner 追加位置')
    const bytes = Uint8Array.from(atob(value.base64), character => character.charCodeAt(0))
    const result = await planProjectFontImport(document, value.filename, bytes)
    return { transaction: result.transaction, affected: [{ id: result.assetId, operation: 'created', ownerKey: 'global',
      authoringAddress: makeAuthoringAddress({ projectId: document.id, scope: 'global', carrier: 'native', layerItemId: result.assetId, field: 'assets' }) }] }
  },
}
