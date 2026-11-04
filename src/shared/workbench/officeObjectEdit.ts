import { z } from 'zod'
import { docxObjectEditSchema, xlsxObjectEditSchema } from './officeWordSheetObjects'

const pptxObjectTargetSchema = z.object({
  slide: z.number().int().nonnegative(),
  part: z.string().min(1),
  partVersion: z.string().regex(/^[a-f0-9]{64}$/),
  shapeId: z.string().min(1),
}).strict().describe('原样沿用当前检查回执中的页索引、部件、部件版本和形状 ID')

const nativeObjectPathStepSchema = z.object({
  name: z.string().regex(/^(?:[a-zA-Z_][a-zA-Z_0-9.-]*:)?[a-zA-Z_][a-zA-Z_0-9.-]*$/).describe('原生 XML 直接子级的限定名称，沿用读取时的命名空间前缀'),
  index: z.number().int().nonnegative().default(0).describe('同命名空间且同名的直接子级中的零基序号'),
}).strict()

const nativeRelationship = z.strictObject({
  id: z.string().min(1), type: z.string().min(1), target: z.string().min(1),
  targetMode: z.literal('External').optional(),
})
const nativePart = z.strictObject({
  path: z.string().min(1), contentType: z.string().min(1),
  xml: z.string().min(1).optional(), base64: z.string().min(1).optional(),
  relationships: z.array(nativeRelationship).optional(),
}).refine(part => (part.xml !== undefined) !== (part.base64 !== undefined), '新增部件须指定 xml 或 base64 之一')
export const officeNativeObjectEditSchema = z.strictObject({
  path: z.array(nativeObjectPathStepSchema).describe('从对象根逐级定位现有原生节点。空数组定位对象根。替换父节点即可新增或调整其子节点。'),
  xml: z.string().min(1).nullable().describe('原生 XML 替换内容。null 删除目标节点。'),
  insert: z.enum(['before', 'after']).optional().describe('在定位节点前或后插入 XML。省略时替换或删除定位节点。'),
  dependencies: z.strictObject({
    parts: z.array(nativePart).optional().describe('需要新建或复制后修改的原生部件。路径必须是新的包内路径。'),
    relationships: z.array(nativeRelationship).optional().describe('由新对象 XML 引用的新关系。ID 在对象所在部件内唯一，内部 Target 相对于该部件。'),
    removeRelationships: z.array(z.string().min(1)).optional().describe('删除原目标节点曾引用且改后没有其他节点引用的关系 ID。'),
    removeParts: z.array(z.string().min(1)).optional().describe('删除原目标依赖图中已不再被任何关系引用的包内部件。'),
  }).optional(),
}).refine(edit => !edit.insert || edit.xml !== null, '插入节点需要 XML 内容')
export type OfficeNativeObjectEdit = z.infer<typeof officeNativeObjectEditSchema>

export const pptxObjectEditSchema = z.object({
  format: z.literal('pptx'),
  target: pptxObjectTargetSchema,
  edit: officeNativeObjectEditSchema,
}).strict()

const docxNativeEditSchema = docxObjectEditSchema.pick({ format: true, target: true }).extend({ native: officeNativeObjectEditSchema })
const xlsxNativeEditSchema = z.strictObject({ format: z.literal('xlsx'), target: xlsxObjectEditSchema.shape.target, native: officeNativeObjectEditSchema })
const nativeFormat = z.enum(['docx', 'xlsx', 'pptx'])
const packagePartEditSchema = z.strictObject({
  format: nativeFormat,
  packagePart: z.strictObject({ part: z.string().min(1), partVersion: z.string().regex(/^[a-f0-9]{64}$/) })
    .describe('从原生部件读取回执沿用路径及版本。可编辑标题、样式、工作簿等无法通过对象句柄定位的 XML。'),
  native: officeNativeObjectEditSchema,
})
export const officeObjectEditSchema = z.union([pptxObjectEditSchema, docxObjectEditSchema, xlsxObjectEditSchema, docxNativeEditSchema, xlsxNativeEditSchema, packagePartEditSchema])
export type OfficeObjectEdit = z.infer<typeof officeObjectEditSchema>
export type PptxObjectEditSource = z.infer<typeof pptxObjectEditSchema>
export type PptxObjectPathStep = z.infer<typeof nativeObjectPathStepSchema>
const pptxObjectSourceTarget = pptxObjectTargetSchema.pick({ slide: true, shapeId: true })
export type PptxObjectSourceTarget = z.infer<typeof pptxObjectSourceTarget>
export interface PptxObjectSourceInspection {
  format: 'pptx'
  target: z.infer<typeof pptxObjectTargetSchema>
  xml: string
}
const dependency = z.string().min(1).optional().describe('读取该对象实际引用的包内部件路径，从对象源码回执的 relationships[].part 取得。')
const officeScopedObjectSourceTargetSchema = z.discriminatedUnion('format', [
  z.strictObject({ format: z.literal('pptx'), target: pptxObjectSourceTarget, dependency }),
  z.strictObject({ format: z.literal('docx'), target: docxObjectEditSchema.shape.target, dependency }),
  z.strictObject({ format: z.literal('xlsx'), target: xlsxObjectEditSchema.shape.target, dependency }),
])
export type OfficeScopedObjectSourceTarget = z.infer<typeof officeScopedObjectSourceTargetSchema>
export const officeObjectSourceTargetSchema = z.union([
  officeScopedObjectSourceTargetSchema,
  z.strictObject({ format: nativeFormat, packagePart: z.string().min(1).describe('读取指定现有原生包部件') }),
  z.strictObject({ format: nativeFormat, packageParts: z.literal(true).describe('列出原生包部件路径、类型与版本') }),
])
export type OfficeObjectSourceTarget = z.infer<typeof officeObjectSourceTargetSchema>
export type OfficeNativeRelationshipInspection = z.infer<typeof nativeRelationship> & { part?: string }
interface OfficeNativeDependencyInspection {
  relationships: OfficeNativeRelationshipInspection[]
  dependencySource?: {
    path: string
    contentType: string
    xml?: string
    base64?: string
    relationships: OfficeNativeRelationshipInspection[]
  }
}
export type OfficeScopedObjectSourceInspection = (PptxObjectSourceInspection
  | (Pick<z.infer<typeof docxObjectEditSchema>, 'format' | 'target' | 'properties'> & { xml: string })
  | (Pick<z.infer<typeof xlsxObjectEditSchema>, 'format' | 'target' | 'style'> & { xml?: string })) & OfficeNativeDependencyInspection
export type OfficeObjectSourceInspection = OfficeScopedObjectSourceInspection
  | { format: z.infer<typeof nativeFormat>; packageParts: Array<{ part: string; partVersion: string; contentType?: string }> }
  | { format: z.infer<typeof nativeFormat>; packagePart: { part: string; partVersion: string; contentType?: string };
      xml?: string; base64?: string; relationships: OfficeNativeRelationshipInspection[] }
