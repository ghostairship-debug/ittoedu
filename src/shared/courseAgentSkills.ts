/** Product-owned candidate guidance, embedded identically for every supported CLI. */
const common = '以本轮不可变快照、观察和正式能力合同为当前工程依据。可使用 CLI 原生文件、终端、网络、技能与子任务完成用户授权任务；完整资源在本轮 workspace 内按需读取。工程修改只返回宿主可提交的结构化候选，不直接改写 .h5lesson 或其他会话。遵循 Native → Recipe → Existing Component → Generated Component → Runtime；选择高阶载体必须说明低阶能力不能满足的具体需求。候选检查与宿主提交是不同状态，不把 CLI 原生工具成功说成工程已修改。'
export const courseAgentSkills = [
  { name: 'course-design', body: '输入：教学主题和明确引用的材料。输出：教师可读的教学策划与呈现脚本草案。先建立新知识的讲解、证据或观察路径，再安排练习；新知识不能只在答案反馈中首次出现。信息不足先提出少量关键问题。停点：策划、脚本分别等待教师看过当前版本后确认；不产生工程修改候选。' },
  { name: 'course-build', body: '输入：本轮 confirmedDocuments 中已经分别确认的 teachingPlan 和 presentationScript。缺任一文件则停下请求确认，不以提前授权替代当前文件确认。按片段保留教学作用、布局、讲解、操作与前后路径；输出正式工具多步候选，前序新对象只用 created-item/created-scope 引用。交付摘要注明哪些视觉与互动还需实际宿主检查，不宣称教师已验收。' },
  { name: 'qa-repair', body: '输入：当前目标、诊断和具体失败证据。限定一次局部修复候选，只修证据指向的问题；没有可定位证据时返回所缺信息。输出变更范围、预计行为和待复核项。停点：一次候选后等待宿主检查结果，不能自行循环重试或扩成全课重写。' },
  { name: 'style-remix', body: '输入：已引用对象和用户的视觉意图。修改现有正式内容、样式、frame 或设计 token 槽位，保留稳定身份、教学文字和交互意图。输出能由正式工具解释的候选，不输出全工程 JSON patch；缺少槽位支持时明确说明，不另造字段。' },
  { name: 'pro-editing', body: '输入：当前选择、页或整课引用及明确编辑目标。最先核对可编辑目标、owner、Surface、state 与 revision；只使用 destinations 中的目标和前序创建结果。局部修改保留其他对象、素材引用与阅读顺序。输出可一次撤销的候选步骤和影响摘要；目标缺失时停下，不能猜测 ID 或换目标。' },
  { name: 'visual-craft', body: '输入：页面内容、Surface 和视觉要求。先建立标题、解释、图示和操作的层次，保证字号、行距、对比和留白可读，避免遮挡与溢出。Flow 保留正文语义，Spatial 保留世界与镜头语义。只输出现有可编辑载体；未取得实际截图时将视觉检查明确列为待验证，不能仅凭元素存在宣称通过。' },
  { name: 'interaction-craft', body: '输入：教学动作与反馈路径。简单点击、切换、播放媒体使用 Native 声明式交互；局部复杂互动先匹配组件；整页连续机制才使用 Runtime。每个非终点都需要可发现的正文推进动作、反馈和恢复路径。动态代码必须提供静态后备及素材/依赖/精确 origin 声明，并等待宿主编译、生命周期、捕获和真实运行准入；不能靠截图冒充可运行互动。' },
] as const

export function courseAgentSkillMarkdown(skill: typeof courseAgentSkills[number]) {
  const references = skill.name === 'course-design'
    ? '完整策划、信息补全与分别确认方法见 [orchestrate-courseware](../orchestrate-courseware/SKILL.md)。'
    : '完整构建、视觉、推进、互动与交付方法见 [build-courseware-project](../build-courseware-project/SKILL.md) 及其引用资料。'
  return `---\nname: ${skill.name}\ndescription: ${skill.body.split('。')[0]}\n---\n\n# ${skill.name}\n\n${common}\n\n${skill.body}\n\n${references}\n`
}
