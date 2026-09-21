import { generationRepairFeedbackGuidance } from './courseAgentTaskGuidance'

/** Product-owned candidate guidance, embedded identically for every supported CLI. */
export const publicCourseReplyGuidance = '公开摘要/进展/答复用用户语言，只讲未保存修改、变化、失败影响和下一步。协议、ID、revision/draftEpoch/会话计数、别名、堆栈留在日志或结构化交付；summary仅为准备，回执前不能称已修改。用户所需代码/JSON/公式/表格照常呈现。'
export const candidateMediaFileGuidance = '图片交付用media.apply，input={kind:"image",source:{$candidateFile:"resources/image.png"}}；背景用pages.backgrounds目标和placement:"background"。仅需新图时启动原生生图工具，等待时准备布局。结果只取路径/元数据，以原生图片通道看图；禁重复打印完整工具对象或base64。用request.json的fileAccess.mediaDelivery交付，或直接输出本轮resources；可复用reusableMedia。失败后组合正式基础命令或文件兜底，保留未指定字段与已提交成果。无需手写复制、压缩、编码脚本。'
export const generatedImageGuidance = `模型负责图像内容、风格和构图，按显示区域与宽高比调用实际可用图像工具，只用正式支持的参数。取得真实图像后优先用media.apply交付，宿主统一解码并优化副本、导入和应用；失败后可在原授权范围内组合正式基础命令。图片通常长边512–1024像素，小插图争取100–300KB，清晰度优先；文字图、大图细节需要原分辨率时明确preserveResolution:true。宿主保留透明度、比例和完整内容，不覆盖原图。生成式重绘必须使用真实原图和可用图像工具，不能伪造像素变换。${candidateMediaFileGuidance}`
const common = '以本轮不可变快照、观察和正式能力合同为当前工程依据。可使用 CLI 原生文件、终端、网络、技能与子任务完成用户授权任务；完整资源在本轮 workspace 内按需读取。工程修改只返回宿主可提交的结构化候选，不直接改写 .h5lesson 或其他会话。稳定图文和简单交互使用 Native；复杂局部视觉和互动使用已有或生成组件，整页连续机制使用 Runtime。修改已有载体无需重复解释选择理由。候选检查与宿主提交是不同状态，不把 CLI 原生工具成功说成工程已修改。'

/** The in-app entry is separate from externally invoked Skills.  It gives every
 * native CLI an exact staged route without changing the external workflow's
 * explicit-call semantics or requiring a per-user Skill installation. */
export const courseAgentSessionSkill = {
  name: 'courseware-session',
  summary: '本轮课件会话的可选内置方法入口，按需读取完整方法、质量参考和精确能力卡。',
} as const

/** Complete product methods remain sourced from the repository Skills.  The
 * generator copies their entry and Markdown references into the same immutable
 * capability namespace as the product-owned task cards. */
export const courseAgentMethodSkills = [
  { name: 'orchestrate-courseware', summary: '材料理解、教学设计和呈现脚本的完整方法；软件内流程按宿主模式连续推进。' },
  { name: 'build-courseware-project', summary: '可编辑构建、增量保全、视觉互动检查和交付的完整方法。' },
] as const

export const courseAgentSkills = [
  { name: 'course-design', body: '输入：教学主题和明确引用的材料。默认按用户任务持续推进：需要时补问、读取材料、必要策划、创作和检查。不强制四份阶段文稿或导入向导。仅当用户明确要求先看当前真实制品时，才在该稿暂停等待确认。先建立新知识的讲解、证据或观察路径，再安排练习；新知识不能只在答案反馈中首次出现。不产生工程修改候选。' },
  { name: 'course-build', body: '输入：用户当前任务与已有真实文件。若用户已确认当前策划和脚本则使用它们；普通任务不因缺少四阶段文件而停下。按片段保留教学作用、布局、讲解、操作与前后路径；输出正式工具多步候选，前序新对象只用 created-item/created-scope 引用。交付摘要注明哪些视觉与互动还需实际宿主检查，不宣称教师已验收。' },
  { name: 'qa-repair', body: `输入：当前目标、诊断和具体失败证据。每次只提交一个局部修复候选，只修证据指向的问题；没有可定位证据时返回所缺信息。输出变更范围、预计行为和待复核项。${generationRepairFeedbackGuidance}` },
  { name: 'style-remix', body: '输入：当前焦点和用户的视觉意图。修改内容、样式、frame 或设计 token，保留未要求修改的身份、教学文字和交互。焦点不限制用户要求的其他对象；快捷工具不足时用原生 CLI 编辑暂存 V9 工作副本，经 project.document 提交实际结果；遵守当前 Schema，不另造字段。' },
  { name: 'pro-editing', body: '输入：当前选择、页或整课引用及明确编辑目标。最先核对可编辑目标、owner、Surface、state 与 revision；只使用 destinations 中的目标和前序创建结果。局部修改保留其他对象、素材引用与阅读顺序。输出可一次撤销的候选步骤和影响摘要；目标缺失时停下，不能猜测 ID 或换目标。' },
  { name: 'visual-craft', body: '输入：页面内容、Surface 和视觉要求。先建立标题、解释、图示和操作的层次，保证字号、行距、对比和留白可读，避免遮挡与溢出。Flow 保留正文语义，Spatial 保留世界与镜头语义。只输出现有可编辑载体；未取得实际截图时将视觉检查明确列为待验证，不能仅凭元素存在宣称通过。' },
  { name: 'interaction-craft', body: '输入：教学动作与反馈路径。简单点击、切换、播放媒体使用 Native 声明式交互；局部复杂互动先匹配组件；整页连续机制才使用 Runtime。每个非终点都需要可发现的正文推进动作、反馈和恢复路径。动态代码必须提供静态后备及素材/依赖/精确 origin 声明，并等待宿主编译、生命周期、捕获和真实运行准入；不能靠截图冒充可运行互动。' },
] as const

/** All paths that the profile may hand to a native CLI.  This is deliberately
 * a resource index, not a menu or a separate Skill execution engine. */
export const courseAgentAvailableSkills = [
  courseAgentSessionSkill,
  ...courseAgentMethodSkills,
  ...courseAgentSkills,
] as const

export const courseAgentProductSkills = [courseAgentSessionSkill, ...courseAgentSkills] as const

export function courseAgentSkillSummary(skill: typeof courseAgentAvailableSkills[number]) {
  return 'summary' in skill ? skill.summary : skill.body.split('。')[0]!
}

export function courseAgentSessionSkillMarkdown() {
  return `---\nname: ${courseAgentSessionSkill.name}\ndescription: ${courseAgentSessionSkill.summary}\n---\n\n# 课件会话方法\n\n${common}\n\n${publicCourseReplyGuidance}\n\n这是应用内随会话交付的可选方法入口，不要求教师或当前 CLI 用户另行安装课件 Skill，也不是开始任务前的必读资料。先使用本轮快照、目标范围和正式能力合同；它们足够时直接完成任务。普通 Markdown 的局部改字、改写或选区修订不读取本方法或其他课件方法。只有当前任务确实需要材料理解、教学主线、呈现脚本、构建、课件修改、视觉互动检查或交付方法时，才按需读取对应小卡、[orchestrate-courseware](../orchestrate-courseware/SKILL.md)、[build-courseware-project](../build-courseware-project/SKILL.md) 及其直接引用的质量资料或精确能力卡。软件内自动任务不因外部显式调用所需的逐稿确认而停下，只有用户明确要求先审当前真实制品时才等待。\n\n完整方法只提供内容与质量判断；应用内修改仍走本轮 request.json、正式能力卡和候选事务。不要安装外部副本、调用外部独立 Builder 命令，或用方法文本替代宿主回执。保留原生 CLI 的文件、终端、网络、工具、连接、Skills 和子任务能力。\n`
}

export function courseAgentSkillMarkdown(skill: typeof courseAgentSkills[number]) {
  const references = skill.name === 'course-design'
    ? '完整策划、信息补全与分别确认方法见 [orchestrate-courseware](../orchestrate-courseware/SKILL.md)。'
    : '完整构建、视觉、推进、互动与交付方法见 [build-courseware-project](../build-courseware-project/SKILL.md) 及其引用资料。'
  return `---\nname: ${skill.name}\ndescription: ${skill.body.split('。')[0]}\n---\n\n# ${skill.name}\n\n${common}\n\n${publicCourseReplyGuidance}\n\n${skill.body}\n\n${['pro-editing', 'visual-craft', 'course-build'].includes(skill.name) ? generatedImageGuidance + '\n\n' : ''}${references}\n`
}
