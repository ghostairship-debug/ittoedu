import { z } from 'zod'

/** Optional: the course file name or path (or a document handle); omit when the task has one course. */
const project = z.string().min(1).max(1000).optional()
const path = z.string().min(1).max(500)

export const projectFileToolSchemas = {
  'project.list': z.object({ project }).strict(),
  'project.read': z.object({ project, path, offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(200_000).optional() }).strict(),
  'project.write': z.union([
    z.object({ project, path, content: z.string().max(4_000_000) }).strict(),
    /** Copy an image into assets/: a workspace file path or an image resource of this task. */
    z.object({ project, path, from: z.string().min(1).max(1000) }).strict(),
  ]),
  'project.edit': z.object({ project, path, edits: z.array(z.object({ old: z.string().min(1), new: z.string() }).strict()).min(1).max(50) }).strict(),
  'project.move': z.object({ project, from: path, to: path }).strict(),
  'project.delete': z.object({ project, path }).strict(),
  'project.save': z.object({ project }).strict(),
} as const
export type ProjectFileToolName = keyof typeof projectFileToolSchemas
export const isProjectFileToolName = (name: string): name is ProjectFileToolName => Object.hasOwn(projectFileToolSchemas, name)

const descriptions: Record<ProjectFileToolName, string> = {
  'project.list': '列出课件工程的文件：theme.css 主题、slides/<序号>-<名称>.html 演示页（可编辑页或整页程序）、docs/<名称>.html 讲义、components/ 组件（含草稿与原因）、assets/ 素材、页面或主题引用但尚未提供的待填素材和待写组件、controller/教师控制台.js。不需要句柄或编号。',
  'project.read': '读取工程内一个文件的当前内容（已含人工修改）。页面是普通 HTML，素材用 ../assets/<名称> 相对引用；SVG 素材返回文本，其他素材返回类型与尺寸。很长的文件用 offset/limit 续读。',
  'project.write': '整份写入一个工程文件：写已有文件前须先读取，读取后若被人改过会失败并提示重读；写新路径即新建（slides/03-名称.html 插入为第 3 页）。页面写普通 HTML/CSS/SVG，不写翻页、键盘和缩放；含脚本的页面按整页程序经准入后提交。docs/<名称>.html 是一份连续讲义（标题即导航位置，至少一个；公式写 \(…\) 与 \[…\]）；theme.css 是整课主题；components/<名称>.html 是可独立运行的互动组件，经准入后所有引用页一起更新，未通过时存为草稿并返回原因。assets/<名称>.svg 写 SVG 文本；图片也可用 from 从工作区文件或本任务图片结果复制。软件对齐对象身份并作为一次可撤销修改提交。',
  'project.edit': '局部替换工程文件中的原文：每处 old 必须在当前文件中唯一出现，否则失败，请重新读取后给出更长的原文。多处替换按顺序一次提交、一次撤销。',
  'project.move': '改名或移动工程文件：页面可改名或改序号调整顺序（只在同一演示表面内）；讲义改名即改表面名称；组件、素材改名时，引用它们的页面与主题一并更新。',
  'project.save': '把课件保存到它的文件。只在用户明确要求保存时调用：修改默认留在编辑器中，由用户保存，关闭时会提示；只读任务不能保存。',
  'project.delete': '删除工程文件：删除页面即删除该场景、删除讲义即删除该讲义表面，按现有规则清理导航与引用（至少保留一页）；删除组件或素材后，引用处显示待填占位；仍被其他对象使用的素材不能删除。',
}

/** Single catalog source for the built-in Agent and external MCP. */
export const projectFileTools = (Object.keys(projectFileToolSchemas) as ProjectFileToolName[]).map(name => ({
  name, description: descriptions[name], inputSchema: projectFileToolSchemas[name],
  manual: { label: { 'project.list': '列出工程文件', 'project.read': '读取工程文件', 'project.write': '写入工程文件', 'project.edit': '局部修改工程文件',
    'project.move': '移动工程文件', 'project.delete': '删除工程文件', 'project.save': '保存课件' }[name],
    group: (name === 'project.list' || name === 'project.read' ? 'read' : 'edit') as 'read' | 'edit', targetKinds: ['document'] as ['document'] },
}))
