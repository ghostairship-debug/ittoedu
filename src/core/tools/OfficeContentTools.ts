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
    'office.inspect': '读取现有 DOCX、XLSX 或 PPTX 的真实正文、表格、单元格或幻灯片文字。宿主识别原文件格式并提供可编辑位置和当前版本，不要求处理压缩包或 XML。',
    'office.create': '用内容新建并保存 Word、Excel 或 PowerPoint 原格式文件。content 提供段落/表格、工作表数据/公式或幻灯片内容；软件负责文件组装、登记和保存。path 为目标目录，省略时用会话所属位置；name 为文件名。',
    'office.edit': '局部修改现有 Office 原文件。content 只表达要改的内容，软件保留其他文本、版式和媒体并保存原格式；可用唯一 oldText 或 inspect 提供的位置。先 inspect 后修改，软件自动沿用本任务读取的文件版本；expectedVersion 可省略，提供时要求当前版本一致。Excel 公式实际计算；不支持的公式保留并返回局部诊断。',
  })[name],
  inputSchema: { ...(z.toJSONSchema(officeContentSchemas[name]) as ModelJsonObject), type: 'object' },
}))
