# 下一轮参考创作能力交接

2026-10-20｜HEAD `a8882691`＋当前未提交集成；Project V10／Published V3／Component API 5。已构建当前 Main、Renderer、Player，证据见 [实施结果](IMPLEMENTATION_RESULT.md)。此页供下一轮按需读取，不要求预读全套教学资料或 Schema。

| 创作需要 | 实际入口与已验边界 |
|---|---|
| 普通构图＋局部程序 | 向实际已读页面结构路径调用 `project.apply {path,intent:"insert",from:"lesson.html"}`，lesson 外层普通 HTML/CSS 含 `<iframe src="activity.html" title="局部活动">`；同目录闭包和 srcdoc 已实测，外围文字／图片独立、程序共享局部状态。也可 `operations:[{path,intent:"insert",content:普通片段,region:已观察区域},{path,intent:"insert",content:局部程序,region:已观察区域}]` 同事务采用。 |
| 导航与续改 | 已知目的用 object.insert 的正式 click／interaction.update；相对 Next 用 `click:{action:"scene.next"}`，不必给全部正文加脚本。普通 content／edits 保既有对象和人工 frame；明确 redo 才重新装配，不可靠作者记录映射保原程序并诊断。外层全局 DOM 程序仍可整体保真。 |
| 媒体 | 普通 `<audio src="voice.wav">`、图片和同目录文件沿 from 闭包资源化；采用后读取到的 cw-resource 是工程引用，宿主 lease／导出负责运行 URL 和字节。媒体成果用其实际 `source` 交 media.insert／apply；不要把 job source 当浏览器 src，也不把 WAV 转 Base64 塞进 JS。直接 WAV 作为页面 project.apply.from 当前未适配。相对音频、保存、新 profile 冷开及最终离线真实播放已验。 |
| 局部空间 | 最小共同布局组可声明 `data-gl-layout="stage"`，`data-gl-slot="heading|body|feedback|actions"`，辅助原文 `data-gl-scroll="auxiliary"`，变体 `data-gl-variants="wide compact"`。CSS 可给 `--gl-gap-min/max`、`--gl-padding-min`、`--gl-font-min`，可为 `[data-gl-runtime-variant="compact"]` 写作者自己的 CSS。软件仅在该局部选变体／有界间距，不缩字、不改外框／History，不隐藏正文；人工 inline 覆盖优先。 |
| 动态诊断 | 通过现 view.observe／HTML 观察读取局部布局摘要；派生事实含 contentBox、variant、tried、issues、needsContentDecision。1040×570/590、窄边界、长反馈／资源迟到、允许辅助滚动、人工／locked及无法容纳已验；不足时由作者决定拆分或改表达。声明穿过正式装配、Published、compiled、嵌套子文档及离线。 |
| 场景成果接力 | 结构记录用现 scope.state JSON，标量别名用现 stateBindings；下一页同时读首值和订阅，保实际输入／核对状态，不静默恢复标准答案。人物／题目显示与判断共用当前业务 data 或 Source。正式 data.set→保存冷读已验；任意外来 JS 的可见文案覆盖不承诺自动改未知算法。 |
| 回执与大内容 | 写结果保 commit／usability／诊断、实际路径／frame／版本，不默认返回大正文；短软件入口 content 以 complete 标记。project.read full 超容量仍分页，nextOffset 续固定版本，refresh 明确取当前。内置用实际 programmatic/context 来源，PTC 内部可完整运算但模型返回有界；MCP 大结果用软件给出的 operation.read 票据与 path／范围，不能跨连接／当前空间授权读取。 |
| 动作与继续 | actionReceipt 分开报告派发、应用、目标、取证。已确认应用而观察失败，只重新观察；输入 mismatch 按实际值决定纠正动作。取消／局部期限可结束纯读等待，旧读退役不等于验收成功；未知写保原操作身份查证，不重放。同范围依赖受保护，安全读和无关工作可继续。 |

代表产品链：普通编辑／Undo／另存 GLX→新 PID＋新 profile 真 UI 冷开→公共 document.export→file:/// 断网互动、音频 ended、正式 Next。可查看技术工程 `output/creation-boundary-implementation-20261020/F03/run-wZOO6C/workspace/mixed-saved.glx` 和同目录 `final-u7y88h/mixed-offline.html`，它们仅是软件 fixture。

批量内存后续已修：生产HTML投影的逐字符字符串链是放大根因；默认堆16×5MiB协调器及实际Undo/Redo通过，真实Gateway同尺寸逐项candidate/ACK与Undo通过。Gateway验证仍固定data.set planner，未测80MiB完整UI／磁盘保存，也不承诺任意更大规模；细节见[内存后续结果](IMPLEMENTATION_RESULT.md#batch-memory-followup)。历史OOM保留。

限制：620宽第08页副本仍需内容取舍，原作未改。动态JS资源分析warning仅说明分析未覆盖；不等于运行失败。没有新的完整作者／精品参考／速度和质量签收，本轮0新作者／收费生成请求。下一轮另建参考作品，冻结YOU & ME原件保持；不自动发行。
