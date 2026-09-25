import { flowImageReplacementInputSchema, replaceFlowImage } from '../../../core/tools/imageApplication'
import { flowContextTextRangeSchema, editFlowTextRange } from '../../../core/tools/flowTextSlot'
import { newFlowBlockSchema as newBlock } from '../../../core/tools/toolSchemas'
import { flowTableStructureSchema as structure } from '../../../core/tools/toolSchemas'
import { z } from 'zod'
import { flowBlockSchema } from '../../../shared/courseProjectSchema'
import type { FlowBlock } from '../../../shared/courseProjectTypes'
import { carrierForFlowBlock, findFlowBlockRecursive, makeFlowBlockAuthoringAddress } from '../../../core/tools/flowDocumentModel'
import { insertFlowEditorBlock, updateFlowEditorBlock, deleteFlowEditorBlock, moveFlowEditorBlock, type FlowCommandResult } from '../../course/flowEditorCommands'
import { changeFlowTableStructure } from '../../../core/tools/flowTableContentOperations'
import type { AuthoringToolDefinition } from './executeAuthoringTool'
import { insertionIndex, resolveAuthoringToolScope } from './authoringToolScope'
import { nativeContentInputSchemaByType } from '../../../shared/contracts/native-v1/schema'
import { documentTextContentSchema } from '../../../shared/document/content'
import { parseDocumentMath } from '../../../shared/document/math'

const id = z.string().min(1)
export const flowAuthoringToolInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('insert'), block: newBlock }).strict(),
  z.object({ operation: z.literal('replace'), block: flowBlockSchema }).strict(),
  z.object({ operation: z.literal('edit'), content: documentTextContentSchema.optional(), textRange: flowContextTextRangeSchema.optional(),
    image: flowImageReplacementInputSchema.optional(),
    formula: z.object({ latex: z.string().min(1).max(16384).superRefine((latex, ctx) => { try { parseDocumentMath(latex) } catch (error) { ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '公式无效' }) } }), accessibleText: z.string().trim().min(1).max(4_000) }).strict().optional(),
    textStyle: nativeContentInputSchemaByType.text.shape.runs.element.shape.style.optional(),
    textAlign: z.enum(['left', 'center', 'right']).optional(), lineSpacing: z.number().finite().min(0).max(200).optional() }).strict()
    .refine(value => Object.keys(value).some(key => key !== 'operation' && key !== 'textRange'), '正文窄编辑至少提供一个字段'),
  z.object({ operation: z.literal('delete') }).strict(),
  z.object({ operation: z.literal('move'), parentId: id.nullable(), index: z.number().int().nonnegative() }).strict(),
  z.object({ operation: z.literal('table-structure'), change: structure }).strict(),
])

export const flowAuthoringTool: AuthoringToolDefinition<z.infer<typeof flowAuthoringToolInputSchema>> = {
  name: 'flow.content',
  description: '新Flow默认fluid，沿实际容器排版；已有Flow保留其layout。普通标题、正文、图片和互动放正文block以自然占位，不用viewport绝对文字替代。insert使用create parent:flow-body，block只省略宿主生成的id。精确正文选区使用edit.textRange={slot,start,end}，slot支持field/content/citation/caption/title/body、item、header、cell，start/end按Unicode码点且公式占1；content.inlines只替换该范围，textStyle只设置该范围。整块修改标题、段落或引用块用edit的content.inlines/textStyle/textAlign/lineSpacing；公式用edit.formula的latex和accessibleText，保留formulaId；图片用edit.image.assetId，保留正文布局、说明和块身份。常规图片应用优先media.apply。未指定排版、富文本和元数据保留。replace/delete/move使用Flow block update target；replace必须保留id和类型。完整载体替换使用selection.replace。',
  inputSchema: flowAuthoringToolInputSchema,
  plan({ document, destination, value }) {
    const { target, surface } = resolveAuthoringToolScope(document, destination)
    if (surface.type !== 'flow' || target.owner !== 'surface') throw new Error('Flow 正文工具只接受 Flow surface owner')
    const options = { expectedRevision: target.documentRevision }
    let result: FlowCommandResult
    let block: FlowBlock
    let operation: 'created' | 'updated' | 'deleted'
    if (value.operation === 'insert') {
      if (destination.kind !== 'create' || destination.scope.parent.kind !== 'flow-body') throw new Error('插入正文需要 flow-body create scope')
      const parentId = destination.scope.parent.parentBlockId
      const parent = parentId === null ? null : findFlowBlockRecursive(surface.blocks, parentId)?.block
      if (parentId !== null && parent?.type !== 'section') throw new Error('Flow 父分节已失效')
      const siblings = parent?.type === 'section' ? parent.blocks : surface.blocks
      result = insertFlowEditorBlock(document, { surfaceId: surface.id, parentId,
        index: insertionIndex(siblings.map((entry) => entry.id), destination.scope.insertion), block: value.block }, options)
      block = value.block
      operation = 'created'
    } else {
      if (destination.kind !== 'update') throw new Error('更新正文需要完整 update target')
      const found = findFlowBlockRecursive(surface.blocks, destination.target.itemId)
      if (!found) throw new Error('目标正文块已失效')
      block = found.block
      const expectedAddress = makeFlowBlockAuthoringAddress({ projectId: document.id, surfaceId: surface.id, blockId: block.id, carrier: carrierForFlowBlock(block) })
      if (destination.target.authoringAddress !== expectedAddress) throw new Error('正文 authoringAddress 与目标块不匹配')
      const blockTarget = { surfaceId: surface.id, blockId: block.id, parentId: found.parentId }
      operation = value.operation === 'delete' ? 'deleted' : 'updated'
      if (value.operation === 'delete') result = deleteFlowEditorBlock(document, blockTarget, options)
      else if (value.operation === 'move') result = moveFlowEditorBlock(document, blockTarget, { parentId: value.parentId, index: value.index }, options)
      else {
        if (value.operation === 'edit') {
          const textFields = value.content !== undefined || value.textStyle !== undefined || value.textAlign !== undefined || value.lineSpacing !== undefined
          if ([textFields, value.image !== undefined, value.formula !== undefined].filter(Boolean).length !== 1) throw new Error('一次正文窄编辑只能修改一种内容类型')
          if (textFields && !value.textRange && block.type !== 'heading' && block.type !== 'paragraph' && block.type !== 'quote') throw new Error('正文文字窄编辑只接受标题、段落或引用块')
          if (value.textRange && (value.image || value.formula || value.textAlign !== undefined || value.lineSpacing !== undefined)) throw new Error('选区窄编辑只接受 content 或 textStyle，不扩大到整块属性')
          if (value.formula && block.type !== 'formula') throw new Error('正文公式窄编辑只接受公式块')
        }
        const replacement = value.operation === 'edit' && value.textRange
          ? editFlowTextRange(block, value.textRange, value)
          : value.operation === 'edit' && value.image ? replaceFlowImage(document, block, value.image.assetId)
          : value.operation === 'edit' && (block.type === 'heading' || block.type === 'paragraph' || block.type === 'quote')
          ? (() => {
            const content = structuredClone(value.content ?? block.content)
            if (value.textStyle) for (const inline of content.inlines) {
              if (inline.type === 'text') inline.style = { ...inline.style, ...value.textStyle }
              else inline.style = { ...inline.style, ...(value.textStyle.fontSize !== undefined ? { fontSize: value.textStyle.fontSize } : {}), ...(value.textStyle.color !== undefined ? { color: value.textStyle.color } : {}) }
            }
            return flowBlockSchema.parse({ ...block, content,
              ...(value.textAlign !== undefined ? { textAlign: value.textAlign } : {}), ...(value.lineSpacing !== undefined ? { lineSpacing: value.lineSpacing } : {}) })
          })()
          : value.operation === 'edit' && value.formula && block.type === 'formula' ? { ...block, ...value.formula }
          : value.operation === 'table-structure'
          ? block.type === 'table' ? changeFlowTableStructure(block, value.change) : null
          : value.operation === 'replace' ? value.block : null
        if (!replacement || replacement.id !== block.id || replacement.type !== block.type) throw new Error('更新必须保留正文块身份与类型')
        result = updateFlowEditorBlock(document, blockTarget, replacement, options)
      }
    }
    if (!result.ok || !result.nextDocument) throw new Error(result.reason ?? 'Flow 工具提交失败')
    return {
      transaction: { projectId: document.id, baseRevision: document.revision, nextDocument: result.nextDocument, resourceChanges: {},
        selectionHint: { kind: 'authoring-tool-selection', locationId: target.locationId, stateId: null, owner: 'surface',
          itemIds: operation === 'deleted' ? [] : [block.id] } },
      affected: [{ id: block.id, operation, ownerKey: target.ownerKey,
        authoringAddress: makeFlowBlockAuthoringAddress({ projectId: document.id, surfaceId: surface.id, blockId: block.id, carrier: carrierForFlowBlock(block) }) }],
    }
  },
}
