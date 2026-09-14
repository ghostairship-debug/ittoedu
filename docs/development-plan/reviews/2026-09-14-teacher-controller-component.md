# 教师控制台组件化实施记录

2026-09-14。工程候选；不是视觉接受、Owner S3 或发布验收。用户批准按教师控制台组件化方案执行。单执行者，无任务卡，无 Git 提交。

## 已实现

- V9 / Published V2 组件实例新增 strict 可选 role=teacher-controller；全局 Overlay 单份，不与 Native 控制台并存。旧 V9 保持可读，不在打开时迁移。
- UI 和 Builder 新建工程嵌入默认组件源码；全局属性提供显式转换、参数、源码入口、恢复默认源码。转换保留图层身份和原配置，文档/包资源一次事务，支持撤销重做。删除后恢复组件，不重新引入原生默认节点。
- Slide、Flow、Spatial 使用同一角色适配器接入既有导航、观察和 Session。组件可以自由修改 DOM、纹理与分散控件；控制台不继承课件 zoom/pan、Flow scroll 或 Spatial camera。Flow 组件帧不套原生按钮行布局。
- 模式、生命周期和角色约束教师端口；真实接受/拒绝结果不再折叠为“已处理”。异常或不可达提供临时恢复组件，Ctrl+Alt+Home 可唤起；切场/销毁清理临时 UI。正常状态无并列原生导航面板。
- component.controller 提供转换/恢复，既有 component.configure / component.package 负责参数/源码。能力发现、完整教师端口类型和编写指南同步。
- 静态包含开关识别角色；Flow 全页控制台输出实际捕获页脚图片。捕获补齐重复线性渐变和 px stop，修复实测纹理丢失。

## 旧代码边界

新建与已转换工程的呈现不再由 TeacherControllerDom 绘制。仍保留旧 Native reader/renderer、对应属性和必要几何兼容逻辑，服务未转换的旧工程；不能以“有组件了”为由删除这些有效 consumer。导航、观察、Session 是正式宿主能力，继续共享，不能随旧 UI 一并删除。

## 验证证据

- 聚焦单测：严格身份、保存包往返、下一步推进、资源撤销重做、三种新建/删除恢复、锁定、源码恢复、拒绝结果、销毁撤权、空控制台恢复；原控制台布局/Session/作者所有权、Flow Overlay、DOCX 投影、Published 组件与捕获检查通过。能力快照的 Flow 坐标说明有针对性验证。
- output/playwright/teacher-controller-component/result.json：真实 Electron 窗口中三 Surface 缩放和平移前后控制台矩形不变；Flow 实际滚动 300 px、Spatial 切换不同镜头后仍不变，折叠/展开可点击。作者态属性变更和源码入口可见。
- 同目录 controller.html / offline-html.png：实际离线 HTML 运行定制源码并可缩放。controller.docx / footer.png：Flow 输出有页脚图片，实看纸纹、文字和按钮轮廓均保留。此证据不声称任意 CSS 特效都已获得像素等价的静态支持。
- 类型检查、Player / Electron / Renderer 构建及合同/能力产物生成按最终代码准备。生成时完整目录没有截断；轻量索引采用一空格缩进，兼顾 8 KiB 上限与原生逐行读取。
- 扩展运行 aiCapabilities.test.ts 暴露三项未通过断言：project.document 文件传输与旧完整输入断言不符、来源溯源断言、candidate-helper 中 sourceFiles 字符串触发排除断言。默认 jsdom 环境另有 esbuild Uint8Array realm 不匹配，改 Node 环境才执行到上述断言。未将这套扩展测试报告为通过；未为本专题改写其余机制的合同。

## 真实 Luna 与无模型复核分开记录

一次 Codex / gpt-5.6-luna / medium / serviceTier=default 任务，实际 native configuration 的 requested、sent、confirmed 均为 Luna；未开启 Fast、未换模型、未重新启动付费任务。

用户式任务要求三个分散纸质书签“下一步 / 目录 / 重播”、可见纹理、保留折叠和缩放、独立定位。首次候选被拒绝：steps.0.lowerCarrierReason 为 null，工程 revision 保持 1。宿主自动修复未在 600 秒内结束，停止后任务为 cancelled，无 committed 回执。原记录在 output/playwright/teacher-controller-luna，不能计为首轮通过或完整 AI 闭环。

随后在隔离副本中复用其已生成源码，仅解析字符串 input 并重新捕获当前精确目标，未再调用模型。初次复核遇到未重建的 Electron 旧合同；重建 Electron 后，正式 component.package 通过真实动态准入并 committed，revision 1→2，源码/后备素材一并进入事务。保存重开后书签、目录和缩放可运行，见 output/playwright/teacher-controller-replay/receipt.json、lesson.h5lesson、reopened.png。

这证明组件源码深改、资源事务、保存重开与运行路径可用；不证明 Luna 自动交付成功。Luna 样例只有书签结构变化可确认，实际纸纹未达要求，动态语义证据仍为 requires-review；不标记视觉或教师接受。

## 超时跟进（2026-09-14）

原记录事件 143 表明第二轮候选的本地校验已成功，命令耗时 352 ms；任务开始约 376 秒后不再出现新的模型或工具输出，约 597 秒记录取消。因而不能把剩余约 220 秒归因于宿主动态准入或校验进程阻塞；原生会话无输出的原因尚未证实。

定位并修复 Codex 文件与内联交付的转换不一致：文件摄取现在复用内联的 JSON input 解码及可选 null 字段处理，仍在成功终态且明确声明当前文件后摄取，仍执行身份、载体理由、工具与事务校验。首次组件候选确实没有载体理由，转换不会使这种缺失变成合法；修复后的后续候选已补理由，但字符串 input 也必须通过同一转换。未将该修复宣称为已解决原生会话无输出。

聚焦 localAgentHarnessV2 的文件交付及取消用例 9 项通过（其他 56 项未执行），覆盖 wire input/null、缺理由、错误请求、缺文件、坏 JSON、未声明文件与取消期间读取；坏工具 input 保留原值交后续正式工具校验。tsc --noEmit 与 build:electron 通过。本轮未再次消耗模型额度，真实自动交付与纹理质量仍待验证。

用户随后明确授权 Luna 付费测试、自主重跑并默认 Fast，已同步 AGENTS.md。授权更新时已经启动的普通速度复测保留完成：539 秒，两次拒绝（缺少载体理由、写错 baseContentIdentity）后自动修复，正式 committed 一次，revision 1→2，任务 completed；没有人工改写候选后再冒充自动成功。证据在 output/playwright/teacher-controller-luna-rerun。

隔离进程打开该轮实际保存的 lesson.h5lesson，目录可展开，视图 zoomTo(1.5) 与 panTo(-100,-50) 后控制台位置和大小不变。verification/reopened.png 显示三个独立书签，但纹理未显示、目录展开向下越界。自动源码交付已完成，视觉尚未通过；继续以 Luna Fast 在隔离副本针对这两处缺陷修复。

两次 Fast 视觉修复均确认 requested/sent/confirmed 为 gpt-5.6-luna / medium / priority。第一轮 313 秒，参数字符串包装被拒一次后自动修正并 committed，任务 completed，目录越界消失但 CSS 背景仍为 none。第二轮根据实际 computed style 与未加引号 URL 的诊断窄修，219 秒，正式 committed 且 completed，未人工改写候选。各自输入、源码、记录和保存文件位于 output/playwright/teacher-controller-luna-fast-repair 与 teacher-controller-luna-fast-texture。不同任务难度与反馈不同，这些耗时不能作为 Fast 提速比例。

最终隔离重开 teacher-controller-luna-fast-texture/lesson.h5lesson：verification/reopened.png 实看 SVG 纹理可见、目录向上展开；verification/result.json 记录所有目录按钮位于视口内、缩放和平移前后控制台矩形不变。实际点击缩放增加 zoom，收起后只剩展开入口，再展开恢复三按钮。自动交付与这些具体可见行为通过；美术质量及教师接受仍独立，不能宣称无反馈首轮通过。

真实窗口还定位并修复了宿主恢复按钮误报：CoursePlayer 的 activate/resume 早于外层视图显示，原可达性检查读到全零矩形后错误显示恢复入口。检查现延后到下一布局帧，销毁时取消待执行帧。最终真实复核确认没有恢复入口误报；空控制台恢复仍由单测覆盖。教师组件 9 项单测、tsc --noEmit、Player 与 Renderer 构建通过。

后续 Owner 明确要求恢复只位于属性。按此决定，已删除上述播放恢复按钮、隐式快捷键、临时默认控制台及 DOM 可达性探测；属性“控制台维护”默认折叠，显式恢复仍可撤销。源码与真实窗口验证见 [AI 修改流程核查](2026-09-14-ai-editing-friction-audit.md)，此前临时恢复设计不再是当前行为。
