import { z } from 'zod'
import { componentProjectFileSchemas } from '../projectFiles/componentPlatform'
import type { ToolResult } from '../../shared/workbench/tools'
import { hasRunDocument, hasRunWrite, projectToolTarget, toolRegistrationFor } from './ToolRegistration'

/** Optional: the course file name/path or document handle; omission uses the task's current course. */
const project = z.string().min(1).max(1000).optional()
const path = z.string().min(1).max(500)

export const projectFileToolSchemas = {
  'project.list': componentProjectFileSchemas['project.list'],
  'project.read': componentProjectFileSchemas['project.read'],
  'project.apply': componentProjectFileSchemas['project.apply'],
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
  'project.apply': '应用已观察的工程路径，用content或授权工作区from。project.json 可提供 title/background/designTokens/playback 设置补丁，软件维护身份和版本。已有内容时content只修改原对象的内容，保留人工位置、顺序和其他对象；页面结构insert追加独立内容，redo重做所选范围的整体布局，另可surface.add/move/remove/title。theme.css修改整课主题；body.html/body.md修改连续正文，保留浮层；spatial.json修改镜头与路径，软件维护身份。components/源码修改共享定义；页面内源码只改该实例。源码、资产与正式内容为一次可撤销操作并进入恢复稿，不自动存盘。',
  'project.list': '列出Project V10工程虚拟路径，使用project.read/apply。project可用文档、页面、对象或空间路径/关系的已读target：对象列其内容、源码和依赖，页面列本页及关联源码，文档列完整作者内容和全部文件。路径由软件映射，不猜路径或填写内部身份。目录很长时沿用project，将nextOffset传给offset续读同一捕获目录。',
  'project.read': '读取project.list返回的工程虚拟路径的当前正式内容与人工修改；不用file.read读取这些路径。普通Web读HTML，专业组件读data.json；正文读body.html/body.md；空间镜头读spatial.json；单路径/关系target只可修改所选图项，保留首页、镜头与其他图项。components/源码作用于共享定义，页面/global内源码为实例独立实现；workspace中的模块和二进制文件原样保留。很长文本将回执nextOffset传给offset并用limit续读，不使用cursor。后续project.apply固定本次观察的原目标，提交失败保留原文与诊断。',
  'project.write': '整份写入一个工程文件：写已有文件前须先读取，读取后若被人改过会失败并提示重读；写新路径即新建（slides/03-名称.html 插入为第 3 页；首次写 slides/01 新标题复用初始空白页）。页面写普通 HTML/CSS/SVG。导航默认复用教师控制台；用户明确自定义时可深改 controller/教师控制台.js，或删除默认控制台后自写独立导航。含脚本页面整体保真并经准入后提交。spaces/<名称>.html 中 .step 是停靠区块，data-x/y 为中心，data-scale 为正比例、data-rotate 为角度；显式像素宽高或简单 class/id/tag CSS 决定区块大小，否则使用课件画布；.fragment 为停靠点内步骤。带位置属性而无 .step 的区块仅作布景，普通 HTML/CSS 保留；含脚本空间整体承载，不拆脚本旅程。docs/<名称>.html 是连续讲义（标题即导航位置，至少一个；图片用 ../assets/…，互动用 <iframe src="../components/<名称>.html" title height>）；theme.css 是整课主题；components/<名称>.html 经准入后所有引用处一起更新，未通过存草稿并返回原因。assets/<名称>.svg 写 SVG 文本；图片也可用 from 从工作区文件或本任务图片结果复制。软件对齐身份，一次可撤销修改；写入不自动存盘。',
  'project.edit': '局部替换工程文件中的原文：每处 old 必须在当前文件中唯一出现，否则失败，请重新读取后给出更长的原文。多处替换按顺序一次提交、一次撤销。',
  'project.move': '改名或移动工程文件：页面可改名或改序号调整顺序（只在同一演示表面内）；讲义、空间改名即改表面名称，保留位置与对象身份；普通文件链接与组件、素材引用一并更新。',
  'project.save': '把课件保存到它的文件。只在用户明确要求保存时调用：修改默认留在编辑器中，由用户保存，关闭时会提示；只读任务不能保存。',
  'project.delete': '删除工程文件：页面删除场景，讲义或空间删除对应表面，按正式规则清理导航与引用（整课至少一个位置）。删除 controller/教师控制台.js 只移除默认教师控制器，保留独立导航组件和素材。删除组件或素材后引用处显示待填占位；仍被其他对象使用的素材不能删除。',
}

/** Current public tools; legacy file mutation parsers above are not advertised as V10 writers. */
const publicProjectFileNames = ['project.list', 'project.read', 'project.apply'] as const
export type PublicProjectFileToolName = typeof publicProjectFileNames[number]
export interface ProjectFileToolHandlers {
  /** The existing project-file owner and document delivery, including captured-path planning. */
  projectFiles(name: PublicProjectFileToolName, input: unknown): Promise<ToolResult>
}
const registerProject = toolRegistrationFor<ProjectFileToolHandlers>()
export const projectFileRegistrations = publicProjectFileNames.map(name => registerProject({
  name, description: `${descriptions[name]} project省略时使用本任务当前课件；明确file.create/file.open后接续该课件。显式project可参考或修改另一课，不改变当前课件。`, inputSchema: projectFileToolSchemas[name],
  manual: { label: { 'project.list': '列出工程文件', 'project.read': '读取工程文件', 'project.write': '写入工程文件', 'project.edit': '局部修改工程文件',
    'project.move': '移动工程文件', 'project.delete': '删除工程文件', 'project.save': '保存课件', 'project.apply': '应用工程内容' }[name],
    group: (name === 'project.list' || name === 'project.read' ? 'read' : 'edit') as 'read' | 'edit', targetKinds: ['document'] as ['document'] },
}, {
  capability: name === 'project.apply' ? 'write' : 'read',
  effect: name === 'project.apply' ? 'document-edit' : null,
  family: 'content',
  exposure: 'direct',
  supports: context => context.componentContent !== false
    && (name === 'project.apply'
      ? hasRunWrite(context, ['spatial-graph'], 'course-v10') || context.projectFilesAccess === 'write'
      : hasRunDocument(context, 'course-v10') || context.projectFilesAccess !== undefined),
  targets: projectToolTarget,
  handler: (context, input) => context.projectFiles(name, input),
}))
export const projectFileTools = projectFileRegistrations
export function projectFileRegistration(name: string) { return projectFileRegistrations.find(tool => tool.name === name) }
