/** Frozen inputs, not execution results. Changing a case requires a new set version. */
export const CORE_TASK_IDS = [
  'D01', 'D06', 'T01', 'I01', 'I02', 'I04', 'L04', 'L06', 'S01', 'S03',
  'S06', 'A01', 'A02', 'C01', 'C03', 'B01', 'N02', 'M01', 'Q01', 'Q04',
] as const

export type Carrier = 'slide-base' | 'slide-state' | 'slide-shared' | 'flow-body'
  | 'flow-overlay' | 'spatial-world' | 'spatial-shared' | 'global'
export type InputRole = 'title' | 'body' | 'source' | 'shape' | 'image' | 'image-peer'
  | 'formula' | 'component' | 'a' | 'b' | 'c' | 'table' | 'chart' | 'button'
  | 'answer' | 'video' | 'input'
export type TaskVariant = {
  id: string
  carrier: Carrier
  fixture: 'slide-heavy-original-copy' | 'common-input-v1' | 'baseline-slide' | 'baseline-flow' | 'baseline-mixed'
  locationId: string
  surfaceId: string
  sceneId?: string
  stateId?: string
  targetIds: string[]
  targetKind: 'layer-item' | 'flow-block' | 'flow-body-and-overlay' | 'surface' | 'location' | 'project'
  launchScope?: 'selection' | 'current-location' | 'project'
  promptPrefix: string
  session: 'new' | 'continuous'
  exportChoice?: 'offline-html' | 'online-html' | 'pptx' | 'docx'
}
export type CommonTask = {
  id: string
  title: string
  batch: 'B1' | 'B2' | 'B3' | 'B4'
  version: '1.8' | '1.9'
  core: boolean
  instruction: string
  launch: { entry: 'in-app-course-chat'; applyMode: 'auto'; scope: 'selection' | 'current-location' | 'project'; setup: string }
  inputRoles: InputRole[]
  variants: TaskVariant[]
  expected: string[]
  preserve: string[]
  prerequisites: string[]
  manualPreservation?: string
}

export const COMMON_TASK_SET = {
  id: 'r18-common-tasks-v1', frozenOn: '2026-09-12', denominator: 60, minimumFirstCorrect: 49,
  status: 'definition-only', executionResults: 'none',
  profile: {
    application: '普通内部生产窗口，COURSEWARE_E2E_BACKGROUND=0', provider: 'codex',
    model: 'gpt-5.6-luna', reasoningEffort: 'medium',
    serviceTier: '沿原失败会话实际服务档；历史证据未给出有效值时记 unknown，并在首次计分前由原生启动记录确认，禁止猜测 standard',
    entry: '软件内创作助手；不得外部终端代发、人工补工程脚本或换强模型补分',
  },
  scoreRule: '一项全部必选变体首次正确才计 1；难例、缺包和外部能力阻断留在 60 分母；格式修复、用户干预和源码兜底分别记录。',
  evidenceRule: '本目录解析检查只证明输入定义可生成及目标存在；真实 CLI、宿主 committed、视觉/互动、保存重开和适用导出由执行记录证明。',
  commonPreserve: [
    '除指令明确允许的字段、结构及其必要引用外，未请求内容、几何、顺序、可见范围、共享实例与 global 教师控制器保持。',
    '一次逻辑修改由 canonical document/resource transaction 提交；失败、取消、stale 与迟到候选零工程写入。',
    '修改后真实 Undo/Redo、保存和重开结果一致；媒体须有实际字节，公式/表格/图表须保持可编辑。',
  ],
  variantRules: {
    'slide-state': '只修改所指证据态 override；同场景基础态及其他状态保持。',
    'flow-body': '保留 FlowBlock 文档流与嵌套，不转截图或绝对坐标 LayerItem。',
    'flow-overlay': '保留 Flow 正文合成边界、浮层 plane 与响应式尺度。',
    'spatial-world': '保留世界坐标、镜头、路径及关系；不得改成演示页。',
    'slide-shared': '明确 Surface shared 范围；include/exclude locations 不扩大到 global。',
    'spatial-shared': '只用于正式允许的 Native/Component/Media，共享域不承载 Table/Chart。',
    global: '只有显式选中的全课对象允许改变；教师控制器及 visibility 保留。',
  },
  i01: {
    originalInstruction: '帮我将这个形状替换为卡通小狗图片',
    sourceRoot: 'C:/Users/74755/Documents/HTML课件编辑器',
    source: 'tests/fixtures/architecture-baseline/slide-heavy.h5lesson',
    generator: 'scripts/build-architecture-baseline-fixtures.ts',
    originalSessionId: '19571d28-5daf-4929-a7f3-1be3bd0c2af6',
    originalProjectId: 'arch-0-slide-heavy', originalRevision: 1,
    originalLocationId: 'slide-location-intro', originalStateId: 'slide-state-base',
    copyRule: '执行时从上述实际文件只读复制到独立 run 目录；记录当前 source revision/选区快照，绝不覆盖用户原件或用简化 fixture 代替 I01。',
  },
} as const

const allText: Carrier[] = ['slide-base', 'slide-state', 'flow-body', 'flow-overlay', 'spatial-world', 'slide-shared', 'spatial-shared', 'global']
const layers: Carrier[] = ['slide-base', 'slide-state', 'flow-overlay', 'spatial-world', 'slide-shared', 'spatial-shared', 'global']
const images: Carrier[] = ['slide-base', 'slide-state', 'flow-body', 'flow-overlay', 'spatial-world', 'slide-shared', 'spatial-shared', 'global']
const data: Carrier[] = ['slide-base', 'slide-state', 'slide-shared', 'flow-body', 'spatial-world']
const bodies: Carrier[] = ['slide-base', 'slide-state', 'flow-body', 'spatial-world']

export function inputId(taskId: string, role: string): string { return `r18-${taskId.toLowerCase()}-${role}` }

function variant(taskId: string, carrier: Carrier, roles: InputRole[]): TaskVariant {
  const flow = carrier.startsWith('flow-')
  const spatial = carrier.startsWith('spatial-')
  const surfaceId = flow ? 'flow-surface' : spatial ? 'mixed-spatial-surface' : 'slide-surface'
  return {
    id: carrier, carrier, fixture: 'common-input-v1', surfaceId,
    locationId: flow ? 'r18-flow-location' : spatial ? 'r18-spatial-location' : carrier === 'slide-state' ? 'r18-location-evidence' : 'r18-location-base',
    ...(!flow && !spatial ? { sceneId: 'r18-task-scene' } : {}),
    ...(carrier === 'slide-state' ? { stateId: 'r18-state-evidence' } : {}),
    targetIds: roles.length ? roles.map(role => inputId(taskId, role)) : [surfaceId],
    targetKind: roles.length ? carrier === 'flow-body' ? 'flow-block' : 'layer-item' : 'surface',
    launchScope: roles.length ? 'selection' : carrier === 'global' ? 'project' : 'current-location',
    promptPrefix: carrier === 'slide-state' ? '只修改当前证据态，基础态保持。'
      : carrier === 'global' ? roles.length ? '只修改选中的全课共享对象。' : '请放在全课共享层，所有页面可见。'
        : carrier.endsWith('shared') ? '只修改选中的当前 Surface 共享对象，保留原可见范围。' : '',
    session: 'new',
  }
}

function task(id: string, title: string, instruction: string, roles: InputRole[], carriers: Carrier[], expected: string[], preserve: string[], extra: Partial<CommonTask> = {}): CommonTask {
  const family = id[0]!
  const batch = 'DTI'.includes(family) ? 'B1' : 'LS'.includes(family) ? 'B2' : 'AC'.includes(family) ? 'B3' : 'B4'
  return {
    id, title, batch, version: batch === 'B1' ? '1.8' : '1.9', core: (CORE_TASK_IDS as readonly string[]).includes(id),
    instruction, inputRoles: roles, variants: carriers.map(c => variant(id, c, roles)),
    launch: { entry: 'in-app-course-chat', applyMode: 'auto', scope: roles.length ? 'selection' : 'current-location', setup: '打开该变体的独立输入副本，导航到精确 location；按 variant.launchScope（缺省沿任务scope）设置范围，selection 时选择 targetIds；在软件内发送 taskInstruction。目标 ID 只用于宿主设置选区，不追加为模型工程提示。' },
    expected, preserve, prerequisites: [],
    ...(family === 'D' ? { manualPreservation: '另在同一输入副本通过现有属性/排列/图层/页面入口执行同一明确操作；独立记人工保全，不计入 AI 49/60。' } : {}),
    ...extra,
  }
}

const tasks: CommonTask[] = [
  task('D01', '精确改字', '把选中的文字改为“一元二次方程的判别式”，其他保持。', ['title'], allText,
    ['目标文本精确等于指定字符串，仍可编辑；实际画面与保存重开一致。'], ['字号、字体、颜色、frame/Flow 文本层级和其他文字不变。']),
  task('D02', '字体字号', '把选中文字设为微软雅黑、32号。', ['title'], allText,
    ['对应 Native style 或 Flow runs 的字体为 Microsoft YaHei、字号 32；屏幕文字可读。'], ['文字、颜色、几何及未选中文字样式不变。']),
  task('D03', '颜色透明度', '把选中形状填充设为 #2563eb，填充不透明度设为60%。', ['shape'], layers,
    ['fillColor=#2563eb、fillOpacity=0.6，边框和整体 opacity 没有混改。'], ['尺寸、旋转、边框、层级保持。']),
  task('D04', '尺寸旋转', '把选中形状设为宽240、高120，顺时针旋转15度，左上角位置保持。', ['shape'], layers,
    ['frame.width=240、height=120、rotation=15；位置保持。'], ['样式和其他对象保持。']),
  task('D05', '公开参数', '把选中证据卡的标题参数改成“本节要点”，强调色改成 #0f766e。', ['component'], ['slide-base', 'slide-state', 'flow-body', 'flow-overlay', 'spatial-world', 'global'],
    ['既有 evidence-panel 实例 props.title/accent 更新；真实组件显示新标题与色彩。'], ['body、实例几何、共享 package 文件与同包其他实例不变。']),
  task('D06', '对齐分布', '把选中的三个卡片顶部对齐并水平等间距分布，以最左和最右卡片的外边界为范围，不改变大小。', ['a', 'b', 'c'], layers,
    ['三个顶部一致，两个间隙之差不超过1 CSS px；两端边界与卡片尺寸保持。'], ['文字、样式、非选中对象保持；不跨 owner 重排。']),
  task('D07', '调整层级', '把选中蓝色卡片移到同一层中的另外两张卡片上方。', ['a', 'b', 'c'], layers,
    ['a 在同一 owner/plane 内绘制于 b/c 上方，实际重叠处可见。'], ['不越过 Flow 正文边界，不跨 global/surface/scene 排序；几何内容保持。']),
  task('D08', '复制对象', '复制选中卡片一份放在右侧，间距24，原卡片保持。', ['a'], layers,
    ['新增一个可编辑独立实例，x=原右边界+24、y相同；复制图形及文字样式一致。'], ['原实例身份及内容保持，新增 ID 不冲突。']),
  task('D09', '显示隐藏', '将选中对象隐藏，保留它以便稍后重新显示。', ['a'], layers,
    ['对应 owner/状态 visible=false，图层列表仍存在，可撤销恢复。'], ['不删除对象，不错误改成播放初始隐藏，其他状态按变体规则保持。']),
  task('D10', '页面背景', '将当前页面背景设为纯色 #f0fdf4，清除本页背景图片。', [], ['slide-base', 'slide-state', 'flow-body', 'spatial-world'],
    ['当前 scene/state/Flow paper/Spatial 背景为指定纯色，背景图为空。'], ['父级背景与其他页面背景保持；不插入伪背景形状。']),
  task('T01', '纠错改写', '纠正选中段落中的数学错误并改写得适合初学者，保留“a≠0”的前提，写清Δ与实数根数量的三种关系。', ['body'], allText,
    ['改正初始“Δ<0有两个实数根”的错误；Δ>0两个不等、Δ=0两个相等、Δ<0无实数根，含a≠0。', '新知识出现在正文，不能只写进反馈。'], ['段落对象/块、段落层级及强调范围的含义保持，其他内容不改。']),
  task('T02', '保持含义精简', '把选中段落精简到80字以内，保留a≠0和三种判别式结论。', ['body'], bodies,
    ['正文≤80个Unicode字符，三种结论及前提齐全、正确。'], ['不通过删掉一种情况凑字数；未选段落保持。']),
  task('T03', '提炼要点', '将选中段落整理成三条讲解要点：前提、计算、判断；不得丢失Δ<0没有实数根的结论。', ['body'], bodies,
    ['三个可编辑要点层次清楚，前提/计算/三种判断完整。'], ['只组织选中段落内容；Flow 使用语义列表，不伪造成图。']),
  task('T04', '教学例子', '在选中说明后补充一个Δ=0的完整例子：x²−2x+1=0，写出a、b、c、Δ计算及根。', ['body'], bodies,
    ['例子明确a=1、b=-2、c=1、Δ=4−4=0、x=1，位于说明之后。'], ['原说明及已有案例保持；不遮挡后文。']),
  task('T05', '翻译保格式', '把选中段落翻译成英语，数学符号保持，原来加粗的结论在英文中仍加粗。', ['body'], allText,
    ['英语含义准确；a≠0、Δ符号与三种根的结论保留；原强调语义迁移到对应英文范围。'], ['其他对象与正文层级不变，不把旧 runs 数字偏移直接套到新文本。']),
  task('T06', '可编辑公式', '把选中的判别式公式改为一元二次方程求根公式，保留可编辑数学结构。', ['formula'], ['slide-base', 'slide-state', 'flow-body', 'flow-overlay', 'spatial-world'],
    ['公式为 x=(-b±√(b²−4ac))/(2a)，AST 具有分式、根号和上下标；可访问文本对应。'], ['公式字号颜色与范围保持；不替换为截图或普通字符串。']),
  task('I01', '形状换生成小狗', COMMON_TASK_SET.i01.originalInstruction, ['shape'], ['slide-base'],
    ['原选中形状实际变为卡通小狗图片；图像获取、宿主应用、清晰可见和自动反馈闭环。', '原三场景与四位置均可进可回；保存、Undo/Redo和重开正确。'],
    ['原frame、旋转、opacity、层级、可见范围、其他状态、共享图片实例、组件、Runtime及教师控制器保持。'],
    { prerequisites: ['已连接的原生图像生成工具；实际生效 Codex gpt-5.6-luna/medium 与服务档有原生记录。'] }),
  task('I02', '指定图片替换', '把选中图片替换为材料中的“parabola-blue.png”，保持完整显示和原位置大小。', ['image'], images,
    ['所选实例消费指定蓝色抛物线图片真实字节；contain 无裁切，清晰度可审。'], ['实例身份、frame或Flow layout/wrap/caption及共享同源实例保持。']),
  task('I03', '生成知识插图', '在选中说明之后插入一张解释Δ大于零、等于零、小于零与抛物线交点对应关系的知识插图，三种情况都要标明。', ['body'], bodies,
    ['新增插图呈现2交点/相切/无交点三情况，轴、标签与数学关系正确；位置在指定说明后。'], ['原说明不删改，不遮挡，正文保持可编辑。'], { prerequisites: ['原生图像工具可用；生成等待计入用户总等待。'] }),
  task('I04', '共享图单实例替换', '只把选中的第一张共享图片换成材料“parabola-blue.png”，第二张及其他页面使用这张图的实例保持原样。', ['image', 'image-peer'], images,
    ['image 改为蓝图，image-peer 与跨页 shared-guard 仍消费原图；资源入库与实例引用一致。'], ['不得就地覆盖共享原图字节；同包/其他surface/global实例保持。']),
  task('I05', '图片背景', '使用材料“parabola-blue.png”作为当前页面背景，现有内容保持可见。', [], ['slide-base', 'slide-state', 'flow-body', 'spatial-world'],
    ['正式背景属性引用真实蓝图，在正确背景owner呈现。'], ['不创建伪背景普通对象，不改父级与其他页面；透明度和正文可读性检查。']),
  task('I06', '多图对应替换', '将选中的A图替换为“parabola-blue.png”，B图替换为“parabola-red.png”，不要交换对应关系。', ['image', 'image-peer'], images,
    ['A精确蓝图、B精确红图，两个引用各自可追溯。'], ['两实例几何、顺序、裁切策略和其他引用保持；原图素材不误覆写。']),
  task('I07', '优化大图', '优化选中的大图以减少文件体积，最长边不超过1600像素，图上的文字、细线与透明边缘要清楚完整。', ['image'], images,
    ['3200×1800输入被优化至最长边≤1600，实际字节减少；Δ和坐标标签、1px/2px线与alpha边缘视觉可辨。'], ['图片含义、比例、完整内容、显示frame和未选实例保持；不能用坏图或1px图片替代。']),
  task('I08', '真实原图语义编辑', '根据选中图片，将抛物线右侧的红色圆点改成蓝色，并在旁边加上“观察点”，其他图像细节保持。', ['image'], images,
    ['原生图像编辑实际读取原图；只右侧圆点变蓝并出现中文标签，抛物线、轴与左侧圆点不变。'], ['原图不得凭文字重绘猜测；其他共享实例、比例、透明背景保持。'], { prerequisites: ['连接支持真实原图输入的原生图像编辑工具；缺能力记外部阻断，保留分母。'] }),
  task('L01', '标题正文配图', '把选中标题、说明和配图排成清楚的一页：标题上方居中，正文在左，配图在右，留足空白。', ['title', 'body', 'image'], ['slide-base', 'slide-state', 'spatial-world'],
    ['标题frame与文本双重居中；正文/图左右分区，完整可读无重叠。'], ['内容、图像比例、未选对象不变；不无限缩字。']),
  task('L02', '内容对比', '将选中A、B两组内容排成左右对比，标题对齐，相同层级使用一致字号。', ['a', 'b'], ['slide-base', 'slide-state', 'flow-body', 'spatial-world'],
    ['两组边界、标题和对应内容明确，左右可比；Flow保留正文阅读顺序。'], ['两组原内容完整，不合并结论、不改非选中项。']),
  task('L03', '三步卡片', '将选中的三步内容按“识别系数→计算判别式→判断根”组织成三张讲解卡片。', ['a', 'b', 'c'], ['slide-base', 'slide-state', 'flow-body', 'spatial-world'],
    ['三步顺序与文案正确，卡片清晰可编辑，无遮挡或溢出。'], ['完整保留每步内容与数学符号；不重写为互动组件源码。']),
  task('L04', '确认脚本多页课件', '按照材料“confirmed-script.md”创建三页常规课件：概念、例题、总结；使用材料配图，保留现有课程。', [], ['slide-base', 'slide-state'],
    ['新增3个真正可导航场景，顺序/标题/知识获得路径/例题/总结满足固定脚本；文字和公式可编辑。', '从证据态发起也保留原scene及state，新增页不错误叠在当前呈现态。'], ['原有三个场景、四位置、状态和全课控件保留；不把3页伪装成单页图片。'], { prerequisites: ['固定输入材料带已确认脚本场景前提；该模拟前提不代表本任务取得教师实课验收。'] }),
  task('L05', '增补后重排', '在选中说明末尾补上“使用判别式前先确认a≠0”，重新安排本内容区，确保配图和后文不被遮挡。', ['body', 'image'], ['slide-base', 'slide-state', 'flow-body', 'spatial-world'],
    ['句子出现一次，文字完整，无新增遮挡/溢出；尺寸调整有可读结果。'], ['原正文、图片及下一个内容区完整保留。']),
  task('L06', 'Flow图文布局', '把选中说明与配图整理成流式讲义：图片靠右、正文环绕，窄窗口时能继续阅读，浮层批注仍对准内容。', ['body', 'image'], ['flow-body', 'flow-overlay'],
    ['正文保持FlowBlock；正文图使用wrap/right或相应正式布局；1280与760窗口均可读。', '浮层变体操作既有图片浮层，保持plane和统一尺度，不能假造block或遮住后续正文。'], ['正文顺序/嵌套、批注plane、教师控制器与打印/DOCX单次出现规则保持。']),
  task('S01', '文本转表格', '将选中“月份与实验次数”文字转换为可编辑表格，列名为“月份”“次数”，保留全部数据。', ['source'], data,
    ['表格有1月12、2月18、3月15，列头正确；对应正式NativeTable或FlowTableBlock。'], ['未选文字保持，不能截图；生成row/column/cell稳定ID并保存重开。']),
  task('S02', '表格数据修改', '把选中表格中“2月”的次数从18改为20，格式保持。', ['table'], data,
    ['只有2月数据单元格改为20，表格仍可编辑。'], ['行列/单元格ID、顺序、合并、表头/强调样式、其他值保持。']),
  task('S03', '数据转柱状图', '根据选中数据制作柱状图：1月12次、2月18次、3月15次；横轴月份，纵轴次数。', ['source'], data,
    ['可编辑柱状图3分类及值正确，纵轴单位次数、标题明确；真实图形与数据一致。'], ['保留源数据与非选对象；不按柱高截图降级。']),
  task('S04', '系列数据更新', '把选中图表的“实验次数”系列改为1月16、2月20、3月22，其他保持。', ['chart'], data,
    ['同一series下三个point按categoryId正确更新，渲染柱高匹配16/20/22。'], ['category/series/point稳定ID、顺序、色彩、其他系列保持。']),
  task('S05', '图表表现标签', '把选中柱状图改为折线图，显示每个数据标签，纵轴标题为“实验次数（次）”。', ['chart'], data,
    ['同一正式图表切换折线并显示正确值标签及轴标题。'], ['数据、分类、系列身份与范围不变；其他图表不改。']),
  task('S06', 'Spatial关系组织', '把选中的三个内容节点组织成“已知条件→计算判别式→根的结论”的关系图，连线加上关系标签。', ['a', 'b', 'c'], ['spatial-world'],
    ['世界节点重新组织，两条真实Spatial relation按方向连接既有节点，标签明确；镜头可总览。'], ['节点身份/内容、既有路径关系与其他世界节点保持；不伪装成一张关系图图片。']),
  task('A01', '点击揭晓', '让“显示答案”按钮点击后显示选中的答案，进入此页时答案隐藏，重播后重新隐藏。', ['button', 'answer'], ['slide-base', 'slide-state', 'flow-overlay', 'spatial-world', 'global'],
    ['真实点击使答案由隐藏变为可见，重播/重新进入恢复初始隐藏；至少点击及重播各一次。'], ['其他对象可见性、别页同名按钮及其他规则保持。']),
  task('A02', '精确跳转', '让选中的按钮点击后跳到“导入·证据态”，必须进入证据态；再用场景目录能回到出发页。', ['button'], ['slide-base', 'slide-state', 'flow-overlay', 'spatial-world', 'global'],
    ['实际点击导航至slide-location-evidence/slide-scene-intro/slide-state-evidence；目录返回原精确位置。'], ['其他导航、场景顺序、startLocation、浏览历史语义保持；不得只跳基础态。']),
  task('A03', '分步显示', '把选中的三条结论设为依次点击下一步显示，重播回到全部未显示。', ['a', 'b', 'c'], ['slide-base', 'slide-state'],
    ['三次真实下一步分别只新增一条，重播恢复；首态无提前泄露。'], ['原scene/location身份和其他演示状态保留。']),
  task('A04', '按钮控制媒体', '让“播放讲解”按钮播放选中的视频，“暂停讲解”按钮暂停它，不影响其他媒体。', ['button', 'b', 'video'], ['slide-base', 'slide-state', 'flow-overlay', 'spatial-world'],
    ['实际播放按钮后currentTime增加，暂停后停止增加，控制精确视频实例。'], ['其他音视频、音量、引用、视频几何保持。']),
  task('A05', '输入声明式反馈', '为选中输入框配置答案4：输入4并提交显示“正确”；输入其他数字显示“再试一次”。', ['input', 'answer'], ['slide-base', 'slide-state'],
    ['真实输入3/4及提交分别显示正确反馈；状态归一化为number后求规则。'], ['input仅Slide scene；不读通用DOM或生成Runtime源码，未声明state key不得写。']),
  task('C01', '选择题配置', '将选中题干配置成标准选择题：“Δ<0时实数根有几个？”选项为0、1、2，正确答案0，答后显示解释。', ['source'], ['slide-base', 'slide-state', 'flow-body', 'flow-overlay', 'spatial-world'],
    ['正式选择题组件使用公开props完成，点击0判对、点击1/2判错，反馈解释正确；无需新源码。'], ['题干含义、其他题目/同包实例与包源码保持。'], { prerequisites: ['missing-product-leaf：当前catalog无选择题包；按固定题干及这些carrier在B3补正式包，缺包仍属未覆盖。'] }),
  task('C02', '分类排序配置', '用标准分类排序组件将“识别系数、计算Δ、判断根”配置为正确顺序；初始顺序打乱，提交后反馈。', ['a', 'b', 'c'], ['slide-base', 'flow-body', 'spatial-world'],
    ['实际拖动产生真实可见重排；正确/错误顺序提交反馈分别验证。'], ['使用成熟包公开参数，排序不只改变隐藏state而不更新画面。'], { prerequisites: ['missing-product-leaf：当前catalog无分类排序包；B3补产品叶子，禁止拿选择题替换该项。'] }),
  task('C03', '拖拽匹配配置', '用标准拖拽匹配组件配对“Δ>0→两个不相等实根、Δ=0→两个相等实根、Δ<0→无实根”，提供重置。', ['a', 'b', 'c'], ['slide-base', 'slide-state', 'flow-body', 'flow-overlay', 'spatial-world'],
    ['实际拖拽分别验证一组正确/错误匹配；完成三组反馈，重置清空匹配。'], ['三种知识对应、素材与别实例保持；DOM命中不等于拖拽成功。'], { prerequisites: ['missing-product-leaf：当前catalog无拖拽匹配包；B3补正式包且验证以上carrier。'] }),
  task('C04', '计时器配置', '放入标准课堂计时器并设为90秒，提供开始、暂停、重置，到时显示“时间到”。', [], ['slide-base', 'flow-body', 'spatial-world', 'global'],
    ['90秒起始，实际开始递减、暂停稳定、重置90；到零只触发一次结束反馈。'], ['实例范围明确；global不生成每页重复计时器，切页生命周期不遗留计时。'], { prerequisites: ['missing-product-leaf：当前catalog无计时器包；B3补正式包。'] }),
  task('C05', '标准实验参数', '把选中标准单摆实验的摆长改为1.2米，重力加速度改为9.8米每二次方秒，其他参数保持。', ['source'], ['slide-base', 'flow-body', 'spatial-world'],
    ['正式单摆组件已有实例仅公开length/gravity语义参数改变；真实运行周期约2.20秒，其他参数保持。'], ['不修改共享包源码/其他实例；不得将任意证据卡冒充实验。'], { prerequisites: ['missing-product-leaf / missing-instance：当前无正式单摆包和可配置实例。source为冻结实验规格锚点，不假称实例ID；B3必须先补包及初始length=1、gravity=9.8、amplitude=10°的真实实例，留存准备回执后执行此原指令，阻断不从分母删去。'] }),
  task('B01', '指定页标题样式', '只把导入、练习两页的标题统一为微软雅黑、36号、#1d4ed8，水平居中；总结页和共享横幅保持。', [], ['slide-base', 'slide-state'],
    ['两个精确scene标题字体/字号/颜色一致，文本与frame双重居中；全部指定页可读。'], ['总结页标题、正文、状态覆盖、surface/global标题保持；批量结果一次可撤销。']),
  task('B02', '范围术语替换', '仅在选中的内容区把“判别式”统一替换为“判别式Δ”，不要重复添加已有Δ。', ['title', 'body'], ['slide-base', 'slide-state', 'flow-body', 'spatial-world'],
    ['指定范围术语一致，已有“判别式Δ”不变；多次出现全部处理。'], ['引用和其他页面内容不变，数学公式结构不误替换。']),
  task('B03', '既有色板', '将选中的内容区应用课程既有“主色”和“强调色”：标题用主色，卡片边框用强调色。', ['title', 'shape'], ['slide-base', 'flow-overlay', 'spatial-world', 'global'],
    ['使用fixture designTokens既有主色#1d4ed8及强调色#f59e0b，实际呈现一致。'], ['不新增主题状态或假称自动绑定；其他色板、正文、图片色彩保持。']),
  task('B04', '批量图片尺寸', '将选中的两张配图都设为完整显示、宽320高180，保持各自左上角位置。', ['image', 'image-peer'], ['slide-base', 'slide-state', 'flow-overlay', 'spatial-world'],
    ['两个图均contain且frame=320×180，图片完整不失真。'], ['各自位置、asset引用、裁切以外样式及非选中图片保持。']),
  task('N01', '复制页换内容', '复制“练习”页放在它后面，复制页标题改为“巩固练习”，内容改为判断x²−3x+2=0的根；原页保持。', [], ['slide-base', 'slide-state'],
    ['新增独立场景位于原练习后，标题与题目正确，复制的引用有效、可编辑。'], ['原练习内容/ID、原导航、其他页与共享资源保持。']),
  task('N02', '重排章节保链接', '将现有章节顺序改为“总结→导入→练习”，保留每页内容和所有跳转，导入中的两个呈现状态保持。', [], ['slide-base', 'slide-state'],
    ['三个scene及locations按总结/导入两state/练习排序，场景树和Player一致；既有跳证据态按钮仍精确命中。'], ['scene/location/state ID、startLocation策略与全部内容不丢失，不能靠重建课件换ID。']),
  task('N03', '按片段拆并', '将选中讲义章节按“概念”和“例题”拆成两个相邻章节，把原小结合并到例题末尾，内容不得遗漏。', ['a', 'b', 'c'], ['flow-body'],
    ['语义section按指定片段重组，概念/例题/小结各出现一次、顺序正确。'], ['块与引用身份保留；不可按像素切截图，不丢公式或素材。']),
  task('M01', '已有音视频插入', '在当前内容区插入材料“tone.wav”和“motion.webm”，音频用于按钮播放，视频默认不自动播放并显示控制条。', [], ['slide-base', 'slide-state', 'flow-body', 'flow-overlay', 'spatial-world', 'global'],
    ['真实音频可听、视频帧实际运动，双方引用完整；视频默认paused且控件可用。'], ['不调用新生成服务；正式媒体载体/音频库匹配支持域，原媒体与全局控件保持。']),
  task('M02', '替换媒体保引用', '将选中视频替换为材料“motion-blue.webm”，保留已有播放按钮和暂停按钮对它的控制。', ['video', 'button', 'b'], ['slide-base', 'slide-state', 'flow-overlay', 'spatial-world'],
    ['显示蓝色运动视频，原按钮实际播放和暂停同一目标，保存后引用完整。'], ['实例ID、几何、播放行为、其他媒体保持；不留下孤儿规则。']),
  task('M03', '播放与后备', '将选中视频设为静音循环、保留手动播放，并使用材料“parabola-blue.png”作为静态后备图。', ['video'], ['slide-base', 'slide-state', 'flow-overlay', 'spatial-world'],
    ['muted=true、loop=true、autoplay=false；手动播放有效，静态导出显示指定poster。'], ['视频源、音量字段与其他实例保持；静态后备不替代动态媒体。']),
  task('Q01', '溢出修复', '检查并修复选中内容区的文字溢出，所有文字必须保留，字号不得小于24，周围内容不能被遮挡。', ['body', 'image'], ['slide-base', 'slide-state', 'flow-body', 'flow-overlay', 'spatial-world'],
    ['真实1280/760窗口及对应Player中所有正文可读、无裁切或新遮挡，最小字号≥24。'], ['不得删文字、截图或无限缩字；图片与相邻内容保留。']),
  task('Q02', '素材引用修复', '检查选中图片缺失的素材文件，用材料“parabola-red.png”修复这个引用，其他素材不动。', ['image'], images,
    ['诊断定位当前缺失字节，使用明确红图源恢复实际显示；保存/离线重开资源闭合。'], ['不按名称猜替其他图；仅此缺失源及其明确实例可变。']),
  task('Q03', '交互配置修复', '修复“显示答案”按钮：它现在错误地跳转到总结页，应该只显示当前答案，并且重播后答案重新隐藏。', ['button', 'answer'], ['slide-base', 'slide-state', 'flow-overlay', 'spatial-world'],
    ['实际点击留在原位置、显示正确答案，重播隐藏；错误跳转规则被替换。'], ['其他交互/位置/内容不变；不叠加规则导致一边揭晓一边跳页。']),
  task('Q04', '保存重开及导出', '保存当前课件并重新打开，确认内容和互动保持，然后按本次已选择的格式导出。', [], ['slide-base', 'flow-body', 'spatial-world'],
    ['真实保存、关闭、重开同一工程后内容/资源/状态/互动一致；导出文件能由真实consumer打开。', '离线HTML断网仍显示本地素材；在线HTML按网络声明；PPTX/DOCX内容与正式适用导出一致。'], ['保留可编辑工程及身份，不把会话、材料、工具trace写入工程或导出；不得用保存提示替代实际重开。']),
]

// Existing IDs below are read from the committed ARCH-0 archives; new r18-* IDs
// above are created by fixtures.ts, never guessed from a user's current project.
const originalI01 = tasks.find(t => t.id === 'I01')!
originalI01.variants = ['new', 'continuous'].map(session => ({
  id: `original-slide-base-${session}`, carrier: 'slide-base', fixture: 'slide-heavy-original-copy',
  surfaceId: 'slide-surface', sceneId: 'slide-scene-intro', stateId: 'slide-state-base',
  locationId: 'slide-location-intro', targetIds: ['slide-intro-callout'], targetKind: 'layer-item',
  promptPrefix: '', session: session as 'new' | 'continuous',
}))
originalI01.variants.push(...(['slide-state', 'flow-overlay', 'spatial-world', 'slide-shared', 'spatial-shared', 'global'] as Carrier[]).map(carrier => variant('I01', carrier, ['shape'])))
originalI01.launch.setup = '两个original变体只读复制实际slide-heavy后导航intro/base并选择原失败快照核实的callout；新会话与已有会话连续编辑分别执行，连续变体先正常发送“介绍一下当前页面内容，不修改课件。”并等待结束，再逐字发送原指令。其余变体使用各自common-input-v1，按精确location/targetIds选择后发送taskInstruction；不补工程提示。'
for (const v of tasks.find(t => t.id === 'I04')!.variants) v.targetIds = [inputId('I04', 'image')]
tasks.find(t => t.id === 'L06')!.variants.find(v => v.carrier === 'flow-overlay')!.targetKind = 'flow-body-and-overlay'
tasks.find(t => t.id === 'N03')!.variants[0]!.targetIds = ['r18-n03-chapter']
tasks.find(t => t.id === 'Q02')!.prerequisites.push('输入为故意缺少一个独占素材文件的V9副本；若当前加载入口拒绝打开，应记录准备阶段产品阻断，不注入raw Store、不事先补好资源再计分。')

for (const id of ['B01', 'N01', 'N02']) {
  const t = tasks.find(item => item.id === id)!
  t.launch.scope = 'project'
  t.variants = ['slide-base', 'slide-state'].map(carrier => ({
    id: carrier, carrier: carrier as Carrier, fixture: 'baseline-slide', surfaceId: 'slide-surface',
    sceneId: 'slide-scene-intro', locationId: carrier === 'slide-state' ? 'slide-location-evidence' : 'slide-location-intro',
    stateId: carrier === 'slide-state' ? 'slide-state-evidence' : 'slide-state-base',
    targetIds: id === 'B01' ? ['slide-intro-title', 'slide-practice-title'] : ['slide-location-summary', 'slide-location-intro', 'slide-location-evidence', 'slide-location-practice'],
    targetKind: id === 'B01' ? 'layer-item' : 'location', promptPrefix: '', session: 'new',
  }))
}

// Delivery formats are required variants, not additional denominator items.
tasks.find(t => t.id === 'Q04')!.variants = [
  ['baseline-slide', 'slide-base', 'slide-surface', 'slide-location-intro', 'offline-html'],
  ['baseline-slide', 'slide-state', 'slide-surface', 'slide-location-evidence', 'pptx'],
  ['baseline-flow', 'flow-body', 'flow-surface', 'flow-location-start', 'docx'],
  ['baseline-flow', 'flow-body', 'flow-surface', 'flow-location-start', 'offline-html'],
  ['baseline-mixed', 'spatial-world', 'mixed-spatial-surface', 'mixed-location-spatial-detail', 'offline-html'],
  ['baseline-mixed', 'spatial-world', 'mixed-spatial-surface', 'mixed-location-spatial-home', 'online-html'],
].map(([fixture, carrier, surfaceId, locationId, exportChoice]) => ({
  id: `${carrier}-${exportChoice}`, fixture: fixture as TaskVariant['fixture'], carrier: carrier as Carrier,
  surfaceId: surfaceId!, locationId: locationId!, targetKind: 'project', targetIds: [], promptPrefix: '', session: 'new',
  exportChoice: exportChoice as TaskVariant['exportChoice'],
}))
tasks.find(t => t.id === 'Q04')!.launch.scope = 'project'

export const R18_COMMON_TASKS: readonly CommonTask[] = tasks

export function taskInstruction(task: CommonTask, variant: TaskVariant): string {
  return variant.promptPrefix + task.instruction
    + (variant.exportChoice ? `本次已选择：${variant.exportChoice}。` : '')
}
