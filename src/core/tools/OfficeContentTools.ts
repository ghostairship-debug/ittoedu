import { z } from 'zod'
import { officeCreateContentSchema, officeEditContentSchema } from '../../shared/workbench/officeFiles'
import type { ModelJsonObject } from '../../shared/workbench/modelProvider'

const path = z.string().min(1).max(32767)
export const officeContentSchemas = {
  'office.inspect': z.object({ path }).strict(),
  'office.create': z.object({ path: path.optional(), name: z.string().min(1).max(200), content: officeCreateContentSchema }).strict(),
  'office.edit': z.object({ path, expectedVersion: z.string().min(1).max(256).optional(), content: officeEditContentSchema }).strict(),
} as const
export type OfficeContentToolName = keyof typeof officeContentSchemas
export const isOfficeContentTool = (name: string): name is OfficeContentToolName => Object.hasOwn(officeContentSchemas, name)
export const officeContentTools = (Object.keys(officeContentSchemas) as OfficeContentToolName[]).map(name => ({
  name,
  description: ({
    'office.inspect': '读取现有 DOCX、XLSX 或 PPTX 的正文、格式、表格、工作表与单元格、幻灯片对象，以及可定位的图表数值和动画行为。提供文件版本、原件 part/partVersion 和可编辑位置；按返回身份进行修改。',
    'office.create': '用内容新建并保存 Word、Excel 或 PowerPoint 原格式文件。content 提供段落/表格、工作表数据/公式或幻灯片内容；软件负责文件组装、登记和保存。path 为目标目录，省略时用会话所属位置；name 为文件名。',
    'office.edit': '局部修改并保存 Office 原件，保全非目标结构，进入统一撤销历史。先 office.inspect：DOCX支持正文、段落和基础样式；XLSX支持单元格/公式及工作表管理，复杂依赖无法安全维护时拒绝；PPTX对象沿用零基slide、shapeId、part/partVersion。chartValue还须沿用chartPart/chartVersion及系列/点index，同步数值缓存和内嵌工作簿；animationTiming只修改inspect标为editable的已有行为时长。软件沿用本次读取的文件版本；不支持的公式保留并报告计算范围。不扩大文件写入授权。',
  })[name],
  inputSchema: { ...(z.toJSONSchema(officeContentSchemas[name]) as ModelJsonObject), type: 'object' },
}))
