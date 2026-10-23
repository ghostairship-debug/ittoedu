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
  'project.apply': '修改已读工程路径，由唯一正式事务提交，可撤销并进入恢复稿，不自动存盘。content/from/edits三选一；edits.old须在当前已读源文唯一命中，全部成功才提交。普通content保留原对象frame、顺序及邻居；style改外观/CSS，redo重做明确范围。insert向页面或容器添加HTML/CSS/SVG，或对象草稿JSON {kind:"objects",objects:[{definitionId,data,...}或{builtinKey,data?,...}]}；builtinKey支持guoling.text/formula/shape/table/chart/input并由软件提供专业默认，已有definitionId须配data；身份由软件维护。children为子稿，无frame原生group可用grid/flex及普通CSS，文字随列宽增高。完整程序用entry.html + intent:program.set，后续仍沿同一根实例增改；主Source enhance可追加JS/TS模块。operations在同工程成批准备已有路径并一次提交；pages+surface.add支持各页首稿。from可直接采用计算或子任务同组来源，软件收齐依赖、资源和已有assetId；局部region/frame/viewport保人工定位。源码实例覆盖只作用当前实例，共享定义作用全部引用。project.json改作品设置，theme.css改主题，body改连续正文，spatial.json改旅程，container.json改容器；按需读取references中的布局/API示例。成功files给后续路径与提交版本，complete区分实际全文和目录；失败保留输入并给局部修复入口，staleSnapshot重读当前稿，unknown先查原操作。',
  'project.list': '在需要内容地图时列出当前工程虚拟路径、语义摘要、typed入口与正式frame。已有精确目标可直接project.read，无需先列目录。project可用已读文档/页面/对象/空间关系target限定范围。共享API是单独reference路径，按需读取；Source和原始工作区文件完整可读。nextOffset配原project续读固定目录。',
  'project.read': '直接读取已知工程虚拟路径的当前正式内容及人工修改；无需先project.list。query按字面查找当前未保存正文，返回命中附近/行列/offset/版本；limit是命中数。普通读取limit是字符数，full:true请求完整来源，超过本轮容量仍complete:false/nextOffset固定版本分页。nextOffset续读固定来源，省略offset新读当前稿；refresh:true可在给定offset局部读取当前稿，亦可明确重新绑定已改名/重排后的当前自然路径。返回basis/revision/currentRevision区分固定来源与当前稿。frame/viewport是正式外框及内部尺寸，内容续改保外框。共享API按references路径读一次；完整Source/依赖仍可直接按实际路径读取。',
  'project.write': '整份写入一个工程文件：写已有文件前须先读取，读取后若被人改过会失败并提示重读；写新路径即新建（slides/03-名称.html 插入为第 3 页；首次写 slides/01 新标题复用初始空白页）。页面写普通 HTML/CSS/SVG。导航默认复用教师控制台；用户明确自定义时可深改 controller/教师控制台.js，或删除默认控制台后自写独立导航。含脚本页面整体保真并经准入后提交。spaces/<名称>.html 中 .step 是停靠区块，data-x/y 为中心，data-scale 为正比例、data-rotate 为角度；显式像素宽高或简单 class/id/tag CSS 决定区块大小，否则使用课件画布；.fragment 为停靠点内步骤。带位置属性而无 .step 的区块仅作布景，普通 HTML/CSS 保留；含脚本空间整体承载，不拆脚本旅程。docs/<名称>.html 是连续讲义（标题即导航位置，至少一个；图片用 ../assets/…，互动用 <iframe src="../components/<名称>.html" title height>）；theme.css 是整课主题；components/<名称>.html 经准入后所有引用处一起更新，未通过存草稿并返回原因。assets/<名称>.svg 写 SVG 文本；图片也可用 from 从工作区文件或本任务图片结果复制。软件对齐身份，一次可撤销修改；写入不自动存盘。',
  'project.edit': '局部替换工程文件中的原文：每处 old 必须在当前文件中唯一出现，否则失败，请重新读取后给出更长的原文。多处替换按顺序一次提交、一次撤销。',
  'project.move': '改名或移动工程文件：页面可改名或改序号调整顺序（只在同一演示表面内）；讲义、空间改名即改表面名称，保留位置与对象身份；普通文件链接与组件、素材引用一并更新。',
  'project.save': '把课件保存到它的文件。只在用户明确要求保存时调用：修改默认留在编辑器中，由用户保存，关闭时会提示；只读任务不能保存。',
  'project.delete': '删除工程文件：页面删除场景，讲义或空间删除对应表面，按正式规则清理导航与引用（整课至少一个位置）。删除 controller/教师控制台.js 只移除默认教师控制器，保留独立导航组件和素材。删除组件或素材后引用处显示待填占位；仍被其他对象使用的素材不能删除。',
}

/** Current public tools; legacy file mutation parsers above are not advertised as canonical writers. */
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
  targets: async (input, resolver) => {
    if ('operations' in input) {
      const targets = await Promise.all(input.operations.map(operation => projectToolTarget({ project: input.project, path: operation.path }, resolver)))
      return targets.every(Boolean) ? targets.flatMap(value => value!) : undefined
    }
    return projectToolTarget(input, resolver)
  },
  handler: (context, input) => context.projectFiles(name, input),
}))
export const projectFileTools = projectFileRegistrations
export function projectFileRegistration(name: string) { return projectFileRegistrations.find(tool => tool.name === name) }
