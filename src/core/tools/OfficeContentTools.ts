import { z } from 'zod'
import { officeCreateContentSchema, officeEditContentSchema } from '../../shared/workbench/officeFiles'
import { officeObjectEditSchema, officeObjectSourceTargetSchema } from '../../shared/workbench/officeObjectEdit'
import type { ModelJsonObject } from '../../shared/workbench/modelProvider'

const path = z.string().min(1).max(32767)
export const officeContentSchemas = {
  'office.inspect': z.object({ path, object: officeObjectSourceTargetSchema
    .optional().describe('底层修改前读取指定对象的原生内容。页、段落和表格索引从 0 开始。') }).strict(),
  'office.create': z.object({ path: path.optional(), name: z.string().min(1).max(200), content: officeCreateContentSchema }).strict(),
  'office.edit': z.object({ path, expectedVersion: z.string().min(1).max(256).optional(),
    onlySelection: z.boolean().optional().describe('Office 临时编辑卡中，用户明确要求只改选区时设为 true。'), content: officeEditContentSchema }).strict(),
  'office.deepEdit': z.object({ path, expectedVersion: z.string().min(1).max(256).optional(),
    onlySelection: z.boolean().optional().describe('用户明确要求只改选区时设为 true。'), content: officeObjectEditSchema }).strict(),
} as const
export type OfficeContentToolName = keyof typeof officeContentSchemas
export const isOfficeContentTool = (name: string): name is OfficeContentToolName => Object.hasOwn(officeContentSchemas, name)
export const officeContentTools = (Object.keys(officeContentSchemas) as OfficeContentToolName[]).map(name => ({
  name,
  description: ({
    'office.inspect': '读取当前 DOCX、XLSX 或 PPTX 的正文、表格、工作表、幻灯片对象、图表和动画。可按 object 读取原生 XML 和依赖。对页眉、工作簿等需要直接定位的结构，可列出包内部件或按部件路径读取。按返回的文件版本、部件版本及对象身份修改。',
    'office.create': '用内容新建并保存 Word、Excel 或 PowerPoint 原格式文件。content 提供段落/表格、工作表数据/公式或幻灯片内容；软件负责文件组装、登记和保存。path 为目标目录，省略时用会话所属位置；name 为文件名。',
    'office.edit': '局部修改 Office 内容，保全非目标结构，进入统一撤销历史。已打开的文件修改进入可编辑草稿，是否已写入原件以 saved 回执为准。先 office.inspect：DOCX支持正文、段落和基础样式；XLSX支持单元格/公式及工作表管理，复杂依赖无法安全维护时拒绝；PPTX对象沿用零基slide、shapeId、part/partVersion。chartValue还须沿用chartPart/chartVersion及系列/点index，同步数值缓存和内嵌工作簿；animationTiming只修改inspect标为editable的已有行为时长。软件沿用本次读取的文件版本；不支持的公式保留并报告计算范围。不扩大文件写入授权。',
    'office.deepEdit': '当常规 office.edit 无法表达需要的修改时，按对象或原生 XML 部件修改已打开的 Office 草稿。可增删、重组原生节点并更新依赖关系。先用 office.inspect 读取位置及版本。修改直接进入当前草稿和统一撤销历史。发生实际冲突时，按报错位置读取最新稿并在本任务修正。',
  })[name],
  inputSchema: { ...(z.toJSONSchema(officeContentSchemas[name]) as ModelJsonObject), type: 'object' },
}))
