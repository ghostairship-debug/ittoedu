import { z } from 'zod'

/** Optional: the course file name or path (or a document handle); omit when the task has one course. */
const project = z.string().min(1).max(1000).optional()
const path = z.string().min(1).max(500)

export const projectFileToolSchemas = {
  'project.list': z.object({ project }).strict(),
  'project.read': z.object({ project, path, offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(200_000).optional() }).strict(),
  'project.write': z.union([
    z.object({ project, path, content: z.string() }).strict(),
    /** Copy an image into assets/: a workspace file path or an image resource of this task. */
    z.object({ project, path, from: z.string().min(1).max(1000) }).strict(),
  ]),
  'project.edit': z.object({ project, path, edits: z.array(z.object({ old: z.string().min(1), new: z.string() }).strict()).min(1) }).strict(),
  'project.move': z.object({ project, from: path, to: path }).strict(),
  'project.delete': z.object({ project, path }).strict(),
  'project.save': z.object({ project }).strict(),
} as const
export type ProjectFileToolName = keyof typeof projectFileToolSchemas
export const isProjectFileToolName = (name: string): name is ProjectFileToolName => Object.hasOwn(projectFileToolSchemas, name)

const descriptions: Record<ProjectFileToolName, string> = {
  'project.list': '列出课件工程的文件：theme.css 主题、slides/<序号>-<名称>.html 演示页、docs/<名称>.html 讲义、spaces/<名称>.html 空间、components/ 组件（含草稿与原因）、assets/ 素材、内容或主题引用但尚未提供的待填素材和待写组件、controller/教师控制台.js。不需要句柄或编号。',
  'project.read': '读取工程内一个文件的当前内容（已含人工修改）。页面是普通 HTML，素材用 ../assets/<名称> 相对引用；SVG 素材返回文本，其他素材返回类型与尺寸。很长的文件用 offset/limit 续读。',
  'project.write': '整份写入一个工程文件：写已有文件前须先读取，读取后若被人改过会失败并提示重读；写新路径即新建（slides/03-名称.html 插入为第 3 页；首次写 slides/01 新标题复用初始空白页）。页面写普通 HTML/CSS/SVG。导航默认复用教师控制台；用户明确自定义时可深改 controller/教师控制台.js，或删除默认控制台后自写独立导航。含脚本页面整体保真并经准入后提交。spaces/<名称>.html 中 .step 是停靠区块，data-x/y 为中心，data-scale 为正比例、data-rotate 为角度；显式像素宽高或简单 class/id/tag CSS 决定区块大小，否则使用课件画布；.fragment 为停靠点内步骤。带位置属性而无 .step 的区块仅作布景，普通 HTML/CSS 保留；含脚本空间整体承载，不拆脚本旅程。docs/<名称>.html 是连续讲义（标题即导航位置，至少一个；图片用 ../assets/…，互动用 <iframe src="../components/<名称>.html" title height>）；theme.css 是整课主题；components/<名称>.html 经准入后所有引用处一起更新，未通过存草稿并返回原因。assets/<名称>.svg 写 SVG 文本；图片也可用 from 从工作区文件或本任务图片结果复制。软件对齐身份，一次可撤销修改；写入不自动存盘。',
  'project.edit': '局部替换工程文件中的原文：每处 old 必须在当前文件中唯一出现，否则失败，请重新读取后给出更长的原文。多处替换按顺序一次提交、一次撤销。',
  'project.move': '改名或移动工程文件：页面可改名或改序号调整顺序（只在同一演示表面内）；讲义、空间改名即改表面名称，保留位置与对象身份；普通文件链接与组件、素材引用一并更新。',
  'project.save': '把课件保存到它的文件。只在用户明确要求保存时调用：修改默认留在编辑器中，由用户保存，关闭时会提示；只读任务不能保存。',
  'project.delete': '删除工程文件：页面删除场景，讲义或空间删除对应表面，按正式规则清理导航与引用（整课至少一个位置）。删除 controller/教师控制台.js 只移除默认教师控制器，保留独立导航组件和素材。删除组件或素材后引用处显示待填占位；仍被其他对象使用的素材不能删除。',
}

/** Single catalog source for the built-in Agent and external MCP. */
export const projectFileTools = (Object.keys(projectFileToolSchemas) as ProjectFileToolName[]).map(name => ({
  name, description: descriptions[name], inputSchema: projectFileToolSchemas[name],
  manual: { label: { 'project.list': '列出工程文件', 'project.read': '读取工程文件', 'project.write': '写入工程文件', 'project.edit': '局部修改工程文件',
    'project.move': '移动工程文件', 'project.delete': '删除工程文件', 'project.save': '保存课件' }[name],
    group: (name === 'project.list' || name === 'project.read' ? 'read' : 'edit') as 'read' | 'edit', targetKinds: ['document'] as ['document'] },
}))
