import { z } from 'zod'
import { planTeacherControllerComponentEdit } from '../../components/teacherControllerComponent'
import { resolveEffectiveLayerTarget } from '../../../core/tools/layerCommands'
import type { AuthoringToolDefinition } from './executeAuthoringTool'

const inputSchema = z.object({ operation: z.literal('restore') }).strict()
export const teacherControllerComponentTool: AuthoringToolDefinition<z.infer<typeof inputSchema>> = {
  name: 'component.controller', inputSchema, usesResources: true,
  description: '恢复当前组件教师控制台的默认源码。使用当前完整 global update target。参数由 component.configure 修改，源码由 component.package 修改。',
  plan({ document, resources, value, destination }) {
    if (!resources) throw new Error('组件资源不可用')
    if (destination.kind !== 'update' || destination.target.owner !== 'global') throw new Error('需要全局控制台的精确 update target')
    const located = resolveEffectiveLayerTarget(document, destination.target)
    if (located.source !== 'global' || located.item.locked) throw new Error('控制台目标不属于全局或已锁定')
    const transaction = planTeacherControllerComponentEdit(document, resources.componentPackages, located.item.layerItemId, value.operation)
    return { transaction, affected: [{ id: located.item.layerItemId, operation: 'updated', ownerKey: destination.target.ownerKey, authoringAddress: destination.target.authoringAddress }] }
  },
}
