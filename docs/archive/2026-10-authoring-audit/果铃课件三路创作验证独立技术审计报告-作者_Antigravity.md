> 原始审计/方案：已由当前实施结果承接；原意见和当时事实不表示当前未修缺口。完整辅助材料见本目录索引。

# 果铃课件三路创作验证底层技术审计报告

- **审查作者**：Antigravity (Google DeepMind)
- **审查日期**：2026-10-06
- **审计标的**：`D:/果铃恢复候选/samples/20261006-ai-three-way/`
- **审计模式**：只读现场证据核查与系统执行架构诊断
- **当前状态**：技术审查完成，已归档供独立复核

---

## 摘要

2026-10-06，针对果铃课件创作“三路验证”（裸 HTML、内置 AI、公共 MCP）的真实运行环境与产物进行了全量只读技术审计。

审计表明：
1. **裸 HTML 组**用时最短（4 分 58 秒），但产物仅为单次吐出的非工程 HTML，且原稿存在严重的电路短路图示缺陷；
2. **内置 AI 组**耗时长达 **50.8 分钟**，历经 **86 次模型请求、152 次工具调用**，累计消耗 **13,839,160 Tokens**。其瘫痪的主要根因是：微观原子级 CRUD 调用模式、`reasoning_effort: max` 叠加巨量上下文（平均 15.8 万 Token/轮）的思考雪崩、`view.observe` 截图引发的 **351 个 Chromium Target 内存泄漏**，以及末端导出构建超时；
3. **公共 MCP 组**由于评测设计失真（未由 Codex 作为主创直接调用工具，而是由脚本驱动 DeepSeek-flash 充当客户端大脑），并在运行时踩中果铃底层 MCP 服务端的严重缺陷：`project.apply` 回执返回百万字符内部 Diff 导致 **82 万 Token 上下文核爆炸（HTTP 400）**、动态工具族（`tools.load`）阻断存盘、截图观察触发 Electron 主进程原生崩溃（退出码 `0xC000001D`），以及内存提交（rev 32）与磁盘落盘（rev 24）脱节。

---

## 一、审计基线与运行现场

所有审计数据与事实均直接取自以下真实运行产物与系统底层日志：

- **基线配置与规划**：
  - 任务内容要求：`D:/果铃恢复候选/samples/20261006-ai-three-way/prepared/common-content-prompt.txt`
  - 统一测试规划：`prepared/PLAN.md`（统一要求：TeamoRouter API，`deepseek-flash`，OpenAI Chat，`reasoning_effort: "max"`）
  - 创作 Skill 规范：`D:/果铃工作台/.agents/skills/orchestrate-courseware/SKILL.md` 及 `references/` 目录
- **执行账本与回执**：
  - 裸 HTML 记录：`bare/output/run-result.json`、`completion.txt`、`observed-summary.md`
  - 内置 AI 运行账本：`profiles/builtin/workbench-v2/runs/8d076adc40e207338de9a18540404843b826e4e892cfa6bfb22987823fbb09df.json`
  - 内置 AI 崩溃与排查日志：`builtin/output/22-passive-crash-log.json`、`23-crash-exact-errors.json`、`25-original-inventory-partial-receipt.md`、`30-terminal-reason-receipt.json`
  - MCP 首轮与中断日志：`mcp/output/run-result.json`、`mcp/output/response-29.json`、`mcp/setup/large-receipt-fields.json`
  - MCP 续轮与崩溃日志：`mcp/resume-1/output/run-result.json`、`tool-78.json`、`mcp/resume-1/setup/main-lifecycle.jsonl`

---

## 二、三路实测真实数据全景对比

| 核心维度 | 裸 HTML 组 (Bare) | 内置 AI 组 (Builtin) | 公共 MCP 组 (两轮累计) |
| :--- | :--- | :--- | :--- |
| **执行起始与结束 (UTC)** | 02:01:21 – 02:06:19 | 02:01:07 – 02:51:57 | 首轮 02:01–02:14 / 续轮 02:35–02:45 |
| **真实执行总时长** | **4 分 58 秒** | **50.8 分钟** | **23 分钟**（两次异常中断） |
| **模型网络请求次数 (Requests)** | **1 次** | **86 次** | **首轮 29 次 + 续轮 16 次 (共 45 次)** |
| **工具调用总数 (Tools)** | 0 次 | **152 次** | **首轮 61 次 + 续轮 18 次 (共 79 次)** |
| **累计消耗 Tokens** | 57,652 tokens | **13,839,160 tokens** (约 1384 万) | **8,437,533 tokens** (约 844 万) |
| **输入 Context (Tokens)** | 523 tokens | 累计 13,580,590，**均轮 157,914** | 累计 8,252,347，首轮峰值达 821,543 |
| **输出 Tokens** | 57,129 tokens | 258,570 tokens | 185,186 tokens |
| **物理课件落盘状态** | 单文件 HTML 存在 | `.h5lesson` 物理保存至 **rev 30** | 磁盘物理文件仅 **rev 24**（rev 32 留于日志） |
| **最终交付结果判定** | 运行正常，**但电路图短路** | 状态卡在 **partial**（导出构建超时） | **两次崩溃失败**（HTTP 400 + 宿主闪退） |

---

## 三、裸 HTML 组审计结论与局限

- **优势**：单次模型调用，端到端 5 分钟完成，无任何状态机、宿主协同和协议开销。
- **实质缺陷**：
  1. 产物为完全不可编辑的死代码，没有课件工程的图层、对象、导航和状态语义；
  2. 原稿电路图存在严重物理错误：在 `parallel9-original-whole-circuit.png` 中，识别图和并联实验图的最右侧导线无负载直跨电源两极，造成物理短路。后续必须依赖人工手动删除 3 处 SVG 旁路才使读数在逻辑上闭合。

---

## 四、内置 AI 组崩塌的四阶段深度解剖

内置 AI 之所以耗时高达 50.8 分钟，是系统在以下四个阶段接连发生性能雪崩与机制失控导致的：

### 阶段 1：启动探索期（第 1 ~ 23 步）
- **现象**：前 10 轮交互没有产出一行课件内容。
- **根因**：`orchestrate-courseware/SKILL.md` 引用了 7 个外部参考文件。模型启动后严格遵循“按需读取”，连续发起了 **6 次 `skills.read`**，把 `project-files.md`、`interaction-design.md`、`teaching-design-quality.md`、`assets.md` 等通读了一遍，造成启动阶段的大量无谓往返。

### 阶段 2：微观 CRUD 与 API 格式试探期（第 24 ~ 69 步）
- **现象**：软件宣称负责装配，但实际暴露给模型的全是微观装配指令：`file.mkdir`、`surface.add`、`object_update`、`project.apply`。
- **直接证据**：运行账本记录（消息 43），模型在调用工具时明确自述：
  > `{"intent":"insert", "content":"<h2>插入测试</h2><p>这是对页面结构 insert 的格式试探。</p>"}`
  模型因缺乏明确的端到端调用范式，耗费了 20 多轮往返在真实环境里试探 `from` 路径、`insert` 格式、`tools.load`、`mcp_discover` 与 `browser_snapshot`。

### 阶段 3：`view.observe` 截图死循环与 351 个 Target 内存泄漏（第 70 ~ 140 步）
- **现象**：模型共发起了 **38 次 `view.observe`**。每写一页就截一张图，看到第 9 页“底部留白 124px”又发起一次往返改到 58px。
- **底层崩溃事实**：
  1. `25-original-inventory-partial-receipt.md` 证实：Electron 内部累积了 **351 个 CDP Targets**（包含大量未回收的预览 iframe 与 WebContents）；
  2. 截图服务彻底失步，频繁返回旧缓存帧；
  3. 渲染进程不堪重负，崩溃日志（`22-passive-crash-log.json`）记录大量：
     `Error: Render frame was disposed before WebFrameMain could be accessed`
     并在后续自动化点击时发生 `locator.click: Target crashed`。

### 阶段 4：保存后 CAS 句柄冲突与导出超时（终验阶段）
- **现象**：课件保存至 rev 30 后，调用 `document.export` 抛出 `target-conflict`；重新调 `file.open` 获取句柄再导出，直接报 `delivery-rejected: 导出构建超时`。
- **根因**：长达 50 分钟的累积泄漏导致 Electron 内部渲染管道假死，导出任务在构建步骤被超时丢弃，最终判定为 `partial`。

---

## 五、公共 MCP 组的两轮崩溃与底层平台暗疾

MCP 组的失败不仅是模型问题，更是果铃外部 MCP 服务端的严重缺陷：

### 1. 评测设定违背 MCP 初衷
- **偏差事实**：MCP 本是供外部高级 Coding Agent（如 Codex CLI 自身）挂载果铃服务进行交互开发的标准协议。本次评测却退化为“编写 Node 自动化脚本，把 DeepSeek-flash 当作 MCP 客户端大脑”。弱上下文管理模型在面对长链路时迅速失控。

### 2. 首轮崩溃：工具回执“核爆炸”（100 万字符 Diff 撑爆 82 万 Token）
- **底层日志**：`mcp/setup/large-receipt-fields.json` 显示，Tool 56、58、61（`project.apply`）返回的 `result.data.receipt.appliedChanges.changes` 单次回执包含超过 **1,000,000 字符**的内部 Diff 树。
- **崩溃节点**：第 28 轮模型上下文被撑到 **821,543 prompt tokens**（请求体达 3.98 MB），第 29 轮 TeamoRouter 直接返回 **HTTP 400** 拒绝服务。

### 3. 动态工具族门槛（`tools.load` 导致保存被拒）
- **异常回执**：客户端调用 `project.save` 时，服务端返回：
  `{"kind":"error","code":"unknown-tool","message":"工具不存在...或用 tools.load 展开工具族。"}`
  后续又报 `bound catalog does not expose project.save`。
- **根因**：平台层过度设计了 `content/layout/media/build/jobs` 动态族展开机制，核心保存工具没有默认常驻，把内部权限状态机强加给了外部标准客户端。

### 4. 续轮崩溃：`view.observe` 击垮 Electron 主进程（退出码 `0xC000001D`）
- **日志记录**：续轮进行到第 79 个工具调用 `view.observe` 时，返回 `observation-failed`。
- **紧随崩溃**：`main-lifecycle.jsonl` 记录 Electron 主进程直接异常退出（退出码 `3221225501` / `0xC000001D` 非法指令/崩溃），外部客户端连接直接断开并抛出 `TypeError: fetch failed`。

### 5. 内存 Commit 与物理 Save 严重脱节
- **现象**：模型通过 MCP 事务推进到了 **rev 32**，但磁盘上的物理 `.h5lesson` 只有 **rev 24**。一旦宿主崩溃，最新 8 个版本的成果全部锁在内存恢复日志中，外部客户端根本拿不到已落盘文件。

---

## 六、深层矛盾剖析：“机械归软件”为什么屡次治理无效？

以往历次治理之所以未能解决“往返过多”，根源在于将**架构执行问题**误当成**提示词纪律问题**：

1. **规则写在文档里，但低阶 API 逼模型当泥水匠**：
   文档虽要求“软件负责装配”，但运行时暴露的工具全是 `file.mkdir`、`surface.add`、`object_update`。缺少阶段性整块交付接口，模型不得不逐步往返。
2. **缺乏硬防护的只读工具**：
   文档声明“禁止全课截图精修”，但执行引擎未设任何防护，`view.observe` 随意调用且毫无内存回收，最终导致 351 个 Targets 击垮 Chromium。
3. **未做防腐隔离的 MCP 接口**：
   MCP 服务端未做 LLM 适配，将几万行的内部 Diff 和复杂的状态机裸露给外部网络，致使外部调用极易遭遇上下文爆炸与连接崩溃。

---

## 七、架构整改规范与执行建议

为使系统具备真实生产可用性，建议实施以下工程整改：

### 1. 纠正 MCP 验证定位
- 严禁再使用自动化脚本套模型调 MCP；
- 恢复由当前 Codex CLI 自身作为主创，直接挂载果铃 MCP Server 自主开发（复用此前火星着陆验证的有效路径）。

### 2. 建立 MCP 服务端防腐层（Anti-Corruption Layer）
- **回执极限截断**：彻底重构 `project.apply` 返回投影，严禁返回内部 Diff 树。回执严格限制在 1KB 内，仅返回状态、影响路径与简短错误；
- **核心工具全常驻化**：移除保存和导出对 `tools.load` 的依赖，`project.read`、`project.write`、`project.save`、`document.export` 必须永久暴露；
- **落盘自动保障**：关键阶段提交支持同步刷盘，消除内存 journal 与物理文件版本脱节。

### 3. 内置 AI 全面推行“粗粒度阶段装配”（三轮强制收敛）
- 废弃微观 CRUD，支持模型通过工作区文件或批量 JSON 一次性提交全课内容，由底层协调器一次性完成装配；
- 将整课创作模型交互严格锁死在 **3 轮以内**：
  - Round 1：产出教学策划与大纲；
  - Round 2：一次性输出全课各页源码与组件，批量装配落盘；
  - Round 3：交付并仅对核心互动做必要单点验收。

### 4. 物理治理 `view.observe` 资源泄漏
- 初始装配阶段直接禁用 `view.observe`，严禁每页截图；
- 单次截图完成后，底层强制调用 `WebContents.destroy()` 彻底销毁预览窗口，严禁 Chromium Targets 积压。

### 5. Skill 与 System Prompt 瘦身
- 废除分散在 `references/` 里的 7 篇碎文档；
- 将标准输入契约与模板以内联方式（One-shot Template）一次性注入系统提示词，彻底终结模型的“API 格式试探”。
