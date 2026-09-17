# 1.9 教师可用性与前端专项 · 实施与验收记录

日期：2026-09-17（随实施滚动更新，未完成前不是验收结论）

## F00｜基线与接口冻结（ROOT）

### 当前工作树基线

- 工作树存在大范围未提交修改（167 文件，+5426/-1097，覆盖 src/main、src/player、src/renderer、tests），是本专项的**当前有效集成基线**，全部实施在其之上进行，不清理、不回滚、不覆盖。
- 任务板 Tasks: 0；单执行者单会话推进，按工作协议不建协调卡。

### 四个用户症状的源码核对结论

| 症状 | 结论 | 证据 |
|---|---|---|
| 材料只能单选 | 实锤：两处 `showOpenDialog` 均无 `multiSelections`，renderer `selectSource()` 返回单数 | `src/main/lessonMaterialDesktopService.ts`、`src/main/materialService.ts`、`LessonMaterialBrowser.tsx` |
| 自动创作无反应 | 实锤：按钮只发 `operation:'set-mode'`，从不发 `start` | `src/renderer/lessonAuthoring/LessonAuthoringPanel.tsx:73` |
| 阶段一直转圈 | 源码级缺陷：panel 轮询 effect 的 catch 只 setError 不重排定时器，一次瞬时 poll 失败即永久停轮询而 main 端 run 仍 running | `LessonAuthoringPanel.tsx:60-65` |
| 材料不可编辑 | 基本属设计现状：仅活动课例内 `.md` 落 `kind:'document'`，其余一律 material；main 硬性拒绝非 .md 保存。可修缺口：课例外根 MD 被误判为 material | `useLessonWorkspaceController.openFile`、`src/main/lessonDocumentFiles.ts` |

### 现状关键事实（冻结为实施前提）

1. **编辑器与工作台已是"同树常驻 + hidden 切换"**：`LessonWorkspaceView` 的 course tab 常驻 children，`LessonWorkspaceShell.test.tsx` 断言 keeps course content mounted；Store 是模块级单例，视图切换不重挂载。真正打断连续性的是换工程（backend 会话整体替换、history 重建）——单例替换模型予以保留，不做多工程并存。
2. **工作空间只是目录字符串**，无持久化 workspace 实体；课例 = `.courseware/lesson.json` + lessonId；会话 `lessonConversationSchema.lesson` 必填，repository 按 `<lessonId>/` 组织——**无项目/工作空间级会话**，这是 F01 的核心扩展点。
3. **"项目"现状 = course 工程身份（WorkspaceIdentityV1 = projectId + normalizedPath）**，挂在会话 projectTarget 上；目录型"项目文件夹"概念不存在，F01 新增。
4. **editorMode（simple/professional）是 100% 外壳 UI 状态**，不进任何命令/校验链；14 个 consumer 文件。例外注意：SceneStateStrip 状态增删改、interaction/runtime 属性、精确几何输入 simple 下无替代入口；`FlowPropertiesPanel` 硬编码 'simple' 隐藏几何（与模式无关，属 Flow 语义，冻结为"Flow 不显示几何字段"）；入场动画编辑器是 simple 专属（取消模式后默认对所有人可见）。
5. **场景/状态双层导航已存在且真实**：ScenePanel（树）+ SceneStateStrip（状态条），`selection.stateId` 流入所有 layer 投影，切换状态确实改变画面；管理命令齐备（activate/add/duplicate/rename/delete/setInitial/setThumbnail/clearOverrides）。
6. **文档 session 强绑课例**：恢复 key = sha256(lessonId+relativePath)，`register-document` 要求文件在课例目录内——根目录 MD 要可编辑必须扩展（F04）。
7. **材料双轨**：课例材料（LessonMaterials，提取结构）与旧工程材料（MaterialRepository，纯文本）并存，本次只动课例材料轨，旧轨不固化不扩建。
8. **无外部宿主打开能力**（无 shell.openPath）；`lessonMaterialDesktopService.ts` 是 F06 窄实现落点。

### 窄接口冻结

- **F01（身份）**：会话归属从 `lesson 必填` 扩展为 `owner: lesson | workspace | project` 判别联合（lesson 保留兼容读取）；repository 目录 lesson 不变，workspace/project 会话存独立子树；AI scope 复用 `localAgent` 既有 workspace 系列能力，不新建第二套 harness。共享 Schema/IPC 单 writer（ROOT）。
- **F02（布局）**：布局偏好只含停靠方向、宽度、收展、工作位置，localStorage 持久化，不进 V9，不持正文/课程副本。`LessonWorkspaceView.tsx` + `lessonWorkspaceShell.css` 单 writer。
- **F04（文档）**：文档服务键从 lessonId 扩展为 `ownerRef`（lesson 或工作空间绝对路径），恢复/版本/冲突语义原样保留。
- **F05（编辑器）**：冻结为无模式——所有能力默认可见（professional 语义），入口唯一化；SceneStateStrip 操作组常驻；入场动画编辑器常驻；Flow 保持无几何字段。
- **F06（宿主打开）**：`lesson:operate` 新增 `open-external` 单操作（内部 `shell.openPath`），越界/失败回执明确。
- 组合根 `LessonWorkspaceHost.tsx`、`LessonWorkspaceShell.tsx`、`App.tsx` 仅 ROOT 写。

### 实施顺序

1. F02 视觉基础（token + 外壳 CSS + 布局偏好）→ 2. F01 身份接线 → 3. F03 导航 → 4. F04 文档/材料 → 先打通纵向流程 A（根 MD 编辑保存布局重开）。5. F05 编辑器 → 6. F06 宿主 → 7. F07 流程 → 8. F08 集成验收（含路径 B、C）。

## 滚动追加：F01–F04 实施结果（2026-09-17 15:40）

### F01 工作空间/项目/会话真实接线 — 代码完成
- `src/shared/workspaceIdentity.ts` 新增 directory/conversation 归属 schema；lesson key 格式不变（`['lesson',lessonId,dir,conversationId]`），directory 为 `['directory',dir,conversationId]`。
- `src/shared/lessonWorkspace.ts` 新增 `conversationOwnerSchema` 判别联合（lesson/workspace/project）、`conversationOwnerOf/Key`，会话 `lesson` 字段改 optional；`lessonProjectSchema` 定义项目身份。
- `src/main/lessonConversationRepository.ts` 按归属分目录（lesson-conversations / workspace-conversations / project-conversations 各 `v1/<hash>`）。
- `src/main/lessonProjects.ts` 新建项目注册表（userData/lesson-projects-v1.json）；`lessonDesktopContract.ts` 新增 `list-projects/create-project/remove-project/open-external`；`lessonDesktopService.ts` 重写 owner 解析与 open-external（`shell.openPath` 回执 `{opened, openError}`，不抛错）；`localAgent/service.ts` lesson-* 分支支持 directory 归属。
- renderer：controller 新增 projects/directoryConversations 等状态与动作；Navigation 泛化 owner；View 左栏四段（资源管理器/工作空间会话/项目/课例）；新增 `DirectoryConversationChat`。
- 验证：`tsc --noEmit -p tsconfig.electron.json` 零错误；相关单测由子代理跑绿。

### F02 视觉与布局 — 代码完成（实机视觉验证并入 F08）
- `variables.css` 全量换 V3.1 暖纸面 token；7 个 css 经 `tmp/v31-remap.py` 重映射；`lessonWorkspaceShell.css` 重写。
- 新增 `useWorkbenchLayoutPrefs.ts`（localStorage `guoling-workbench-layout-v1`）与 `WorkbenchSplitter.tsx`（delta 语义）；`LessonWorkspaceView.tsx` 四向停靠 + 布局条。

### F03 资源管理器、项目会话导航与内容标签 — 代码完成
- 随 F01 renderer 批完成：左栏四段导航、DirectoryConversationChat 接入 Host、内容标签沿用 document/material 双轨。

### F04 文档、材料与文件状态 — 代码完成
- `DocumentFileRef` 改判别联合 `{kind:'lesson',…}|{kind:'file',path}`，波及 ports/lessonDocumentDesktop/lessonDocumentFiles/lessonDocumentDesktopService/lessonAuthoring/lessonAuthoringDesktopService/lessonDocumentAiTask/lessonGenerationContext/LessonDocumentEditor/useLessonWorkspaceController/useDocumentTabsController/LessonWorkspaceView/LessonWorkspaceHost/documentAiTaskController。
- **恢复键连续性**：课例 ref 保持 F04 前键格式 `JSON.stringify([lessonId, relativePath])`（`documentRefKey`），教师未保存恢复稿与 AI 记录不失联；file 归食用 `['file', 规范化路径]`。
- 修复实施中引入的两处回归：`readAiRecords` 过滤条件误把未哈希键与哈希键比较（改 `documentRefKey(value.record.ref) === documentRefKey(ref)`）。
- AI 文档修改守卫：非课例文档（根目录 MD）拒绝 AI 修改并明确提示（`documentAiTaskController.start` 开头收窄）。
- 材料多选：`lessonMaterialDesktopService` select 支持 `multiSelections`，逐文件校验、部分失败逐项回执 `{sources, failures}`；`LessonMaterialBrowser` 循环导入并逐项展示失败。
- 验证：`tsc` 两侧零错误；`LessonDocumentEditor/documentFileSession/fileDocumentClipboard/lessonAuthoring/lessonAuthoringDesktop/lessonDocumentAiTask/lessonDocumentFiles/lessonMaterialSelection` 49/49 绿。

### 未验证（留 F08）
F01–F04 均未做真实应用集成验证；F02 视觉 token 无实机截图；多选材料对话框未实机点选。

### F06 外部宿主打开 — 代码完成
- `LessonDirectoryTree`：文件行悬停出现"在系统应用中打开 ↗"，逐文件调用 `open-external`，失败/无关联程序以行内 alert 展示 `openError`；operation 返回类型放宽为 `LessonDesktopResult`。
- `LessonWorkspaceView` 布局条：活动文件标签（MD/Office 均覆盖）新增"外部打开 ↗"，失败在内容区顶部 alert 展示。
- 样式：`lesson-tree-external` 悬停显隐、`workbench-external-notice` 提示条。
- 验证：renderer tsc 零错误；`LessonWorkspaceShell` 4/4 绿。

### F07 创作流程与助手可用性 — 代码完成
- **模式选择与启动分离**：模式按钮改"手动模式 / 自动模式（按材料）"（仅 set-mode）；新增独立的"开始自动创作"启动按钮（真正发 `operation:'start'`），手动模式沿用"生成当前阶段/构建课件"。
- **前置条件可见**：新增 `lesson-authoring-hint` 常驻提示——自动模式未选材料时明确指引先去「材料」页勾选；就绪时显示已选份数与"留空按材料推进"。
- **自动 start 目标留空可用**：默认指令"根据已选材料自动完成本课例创作，逐阶段推进并在每阶段产出当前稿。"（contract min(1) 约束下）。
- **转圈根因修复**：轮询 effect 重构为自调度 tick，单次 poll/read 失败 setError 后 2 秒重排定时器，不再静默停轮询。
- e2e 同步：`r19LessonAuthoringLuna` / `r19CurrentTeacherAutomaticLuna` / `r19LessonCopyMove` / `r19ScannedMaterial` 按钮名改"自动模式（按材料）"；自动流启动点击改"开始自动创作"；`r19ManualLessonLuna` 改"手动模式"。
- 验证：renderer tsc 零错误；`lessonAuthoringPanel` 4/4 绿（含新增"留空目标自动 start"回归用例；原异步修复轮询用例验证新 tick 循环）。

### F08 集成验收 — 三条教师路径 e2e 在当前最终构建全部通过

三条路径各自建临时工作空间 + 独立 profile 跑真实 Electron 应用（`VITE_DEV_SERVER_URL:''` 走构建产物），证据截图在 `2026-09-17-frontend-special-evidence/`。

**路径 A · 根 MD 编辑与布局偏好（`r19FrontendSpecialPathA.spec.ts`，27.9s 通过）**
工作空间打开 → 资源管理器点根目录 MD 直接进编辑器 → 键入中文保存（A2/A3）→ 内容区停靠切到底部（A4）→ 目录会话新建与发送（A5）→ 重开后布局偏好、目录状态、文件内容连续（A6）。

**路径 B · 项目文件夹 + 多选材料 + 真实自动创作（`r19FrontendSpecialPathB.spec.ts`，32.8s 通过）**
项目指向真实文件夹 → 材料对话框多选两份材料并逐项回执（B1）→ 勾选采用（B2）→ 切自动模式点"开始自动创作"→ **真实 Luna（Codex 通道）自动运行到 running（B3）→ 停止（B4）**。

**路径 C · h5lesson 工作台连续性与真实预览（`r19FrontendSpecialPathC.spec.ts`，52.7s 通过）**
真实 `bind-project` 绑定空白 V9 工程 → 课件标签内完整编辑器（C1）→ 文档/课件标签切换 + 左右停靠切换编辑器 DOM 保持挂载（C2）→ 场景状态新建/重命名/切换（C3）→ 撤销/重做真实进历史 → Ctrl+S 保存重开后状态仍在（C4，重载后按教师真实操作丢弃恢复副本）→ 整课预览打开播放器宿主且有真实子节点（C5）。

**F08 实测修复（3 处真实产品 bug）**
1. `LessonWorkspaceView` 列子节点改带稳定 key 数组渲染（`columnItems` + `<Fragment key>`）：左右停靠互换时 React 移动 DOM 而非重建，编辑器撤销历史不再丢（path C 实测抓出）。
2. `globals.css` `.scene-state-strip__actions` 改 `justify-content:flex-start; margin-left:auto`：原 flex-end 窄宽度溢出时按钮滑到标题下方被拦截（path C 实测抓出，"新建场景状态"点不到）。
3. `lessonWorkspaceShell.css` `.lesson-workspace-columns[hidden]` 加 `!important`：原规则被同优先级、位置更靠后的 `[data-layout=standalone]{display:grid}` 覆盖，着陆页 `hidden` 的列容器实际可见，其中残留模态（如恢复副本对话框）遮挡整页点击（path C 复现 4 次后定位修复）。同类隐患 `.lesson-course-tab[hidden]` 经核对特异性足够（0,2,0 > 0,1,0），无需改动。

**构建与静态检查**
- `npm run build:desktop` 全量构建通过（含上述 3 处修复）。
- 三套 tsc 零错误：`tsconfig.json` / `tsconfig.electron.json` / `tsconfig.e2e.json`（e2e 配置首次启用，7 个既有 spec 补 `kind:'lesson' as const`、修 path A `dockOf` 的 `?? ''` 误用于 Promise、修 `r19LessonCopyMove` 的 `attachSession` 会话属主签名）。

**三分状态**
- 已实现：F00–F08 全部生产代码与三条 e2e 规格。
- 已验证：上述三条路径在当前最终构建逐一通过（A 27.9s / B 32.8s / C 52.7s）；`build:desktop` 通过；三套 tsc 零错误；相关单测此前批次全绿（F04 48/48、F06 4/4、F07 4/4）；F02 视觉 token 由 A1/C1 截图代表确认（暖纸面可见）。
- 未验证：路径 B 的手动四阶段全量确认（`r19ManualLessonLuna`，按 F07 新按钮名更新后待运行）受前台命令 300 秒上限阻断，非本批次缺口；Luna 全量矩阵按任务要求只补受影响路径，未整表重跑；恢复副本对话框在课例绑定流下的出现时机（path C 重载后曾出现，spec 按教师真实操作丢弃副本通过）建议 lifecycle Owner 后续复核判定语义。


## 滚动追加：教师实测反馈修复 + V3.1 左栏层级（2026-09-17 晚）

### 教师实测反馈修复（4 项，全部真实 e2e 复现验证）

1. **owner 路径归一化**：renderer 把 `fs.realpath` 原始形态（大写 + 反斜杠）直接作 `list-conversations` / `create-conversation` 的 owner，schema 要求小写 + 正斜杠 → ZodError，表现为横幅"收到的操作参数无效"与工作空间会话列表加载失败。修：主进程 `lessonDesktopService.resolveOwner` 入口统一 `normalizeOwnerRoot`（win32 `path.win32.normalize` + 小写）；renderer 侧 `directoryOwnerOf` 用既有 `normalized()`、视图 owner prop 用既有 `lower()`。
2. **资源树行 CSS 挤垮文件名**：`.lesson-directory-tree button{width:100%}` 继承自目录树按钮规则，↗ 外链按钮把文件名按钮挤到 8px——"文件只能第三方打开"的真相。处置：删除 ↗ 按钮，改为**智能打开**——`.h5lesson` 进本软件工程、`*.md` 进本软件文档标签、其余走 `open-external` 系统默认应用（失败 throw 给横幅）。
3. **内容区关闭时点文件无响应**：`columnItems` 在 `contentOpen=false` 时不渲染 workbench section，点文件建了标签也不可见。修：`useWorkbenchLayoutPrefs` 新增 `setContentClosed(closed)`；视图资源树 `onFile` 先 `setContentClosed(false)` 再 `openFile`。
4. **资源树 Windows 化**：重写 `LessonDirectoryTree` 为 lucide 图标版（`ChevronRight`/`Folder`/`FolderOpen`/`FileText`·md 蓝/`Presentation`·h5lesson 绿/`File`），目录行 = chevron 按钮（aria-expanded）+ 行按钮双热点展收，文件行点击 = 打开。chevron 曾渲染成空白方框：`.lesson-workspace-shell button`（0,1,1）盖过 `.lesson-tree-chevron`（0,1,0），选择器提升为 `.lesson-directory-tree .lesson-tree-chevron`（0,2,0）解决。

Path A e2e 补强：新增"打开工作空间后 `.lesson-workspace-error` 计数为 0"与"新建工作空间会话后列表真实出现会话按钮"断言（旧断言只查恒在段标题，曾漏检静默失败）。

### V3.1 左栏层级对齐（设计稿 `双形态UI设计/v3/index.html`）

信息架构从四段（资源管理器 / 工作空间会话 / 项目 / 课例与对话）改为三段：**资源管理器（整个工作空间）→ 项目与会话 → 课例与对话**。

- 控制器：`projectConversations: Record<归一化路径, 会话[]>`，打开工作空间 / 建项目 / 移除项目时并行加载各项目会话；`openDirectoryContext` 从"切换目录上下文并自动选中"退化为纯**作用域设定**（新对话归入哪里）；选中会话时作用域跟随会话归属。
- 视图：「项目与会话」单段——工具条（新对话 + 新建项目）、内联建项目表单、项目分组（chevron 展收 + 文件夹图标 + 作用域高亮 + 组内会话导航）、底部**工作空间会话**作用域行（绿色高亮为默认作用域，＋按钮显式 `createDirectoryConversation({kind:'workspace'})` 不受当前作用域影响）。课例与对话段收展改本地 state（原持久化 `conversationsOpen` 让给合并段）。
- 样式：`lessonWorkspaceShell.css` 新增项目分组 / 作用域行规则，选择器一律 `.lesson-workspace-sessions` 前缀（0,2,0+）压过 shell 按钮基础规则；删除失效的 `.lesson-workspace-directory` / `.lesson-workspace-projects` 窗格规则。
- 测试：新增 `r19WorkspaceNavHierarchy.spec.ts`（段顺序、项目分组真实出现、作用域切换、项目会话与工作空间会话分桶、重开恢复）；Path B 项目断言选择器从 `.lesson-workspace-projects` 改 `.lesson-project-group`。

**验证**：Path A/B/C + 新层级 spec 在当前构建全过（约 2.3m）；三套 tsc 零错误。视觉证据：`2026-09-17-frontend-special-evidence/tree-redesign.png`、`V31-nav-hierarchy.png`、`V31-nav-relaunch.png`。

**待 Owner 拍板**：①「课例与对话」段在 V3.1 信息架构中的最终去留（本轮保留在第三段）；②新建项目是否改系统选文件夹对话框（现内联表单）；③创作流程/创作助手面板形态（设计稿聊天区为干净对话 + composer）。


### 新建项目改为系统选文件夹对话框（2026-09-17 19:30）

教师反馈第 4 项落地：点「新建项目」不再出内联填路径表单，改为**先弹系统选择文件夹对话框**（`openDirectory + createDirectory`，默认定位到当前工作空间根，对话框内可直接新建文件夹），选中后回内联确认条：项目名称默认 = 文件夹名（可改）、显示所选文件夹路径、创建项目 / 重新选择… / 取消。

- 合同：`lessonDesktopRequestSchema` 新增 `choose-project-directory`（入参 `directory`，回 `directory`/`cancelled`）。
- 主进程：`lessonDesktopService` 新增 case，`fs.realpath` 归一后返回；越出工作空间或选到工作空间根本身由 renderer 侧 `normalized()` 前缀校验拦截（错误进横幅）。
- 控制器：`creatingProject`/`projectPathInput` 状态删除，新增 `projectFolder` + `pickProjectFolder()` / `cancelProjectPick()`；`createProject()` 固定走 `designate(directory, name, path)` 采用真实文件夹。
- 测试：Path B 与 `r19WorkspaceNavHierarchy` 改为「mock 对话框返回预建文件夹 → 断言名称预填 → 创建项目」。
- **流程教训**：主进程从 `dist-electron/` 加载，改主进程/合同必须 `npm run build:electron`（只 `build:renderer` 会让新操作被 IPC 校验拒掉，报"收到的操作参数无效"）。

**验证**：Path A/B/C + 层级 spec 全过（A/C/层级 2.0m，B 33s 此前单独通过）；三套 tsc 零错误。证据：`V31-project-pick-confirm.png`。


### 外框对齐 V3.1 设计稿（2026-09-17 21:00）

对照 `双形态UI设计/v3/index.html` 逐块落地的外框对齐：

- **顶栏**：新增「布局」弹出层（内容区位置 左/右/上/下、收展侧栏、收展对话区、收展内容区、恢复默认布局），移除散置的"收起侧栏/专注对话"按钮；停靠/默认布局从内容区布局条移入弹出层；「更多」收进"新建工作空间/新建独立课件"。两个弹出层均受控 + 透明遮罩，点击外部自动关闭。
- **布局偏好**：新增 `chatClosed`（持久化），对话区可收起为悬浮「展开对话」条。
- **侧栏**：资源管理器标题加「工作空间」标签并显示根路径；项目分组与工作空间会话改用设计稿式轻量会话行（图标 + 标题，当前项绿点高亮，行内 ⋯ 菜单保留分支/删除，去掉每组搜索框/新对话/管理记录）；项目「移除」悬停显现；新增底部权限说明条（工作空间内完整权限）。
- **聊天列**：新增头部条（对话图标 + 当前会话标题 + 收起内容）。
- **测试**：Path A/C 改走「布局」弹出层操作停靠（点遮罩关闭弹出层后继续）；NavHierarchy 选择器改 `.lesson-session-rows`/`.lesson-session-row`。

**验证**：Path A/B/C + 层级 spec 全过（当前构建）；三套 tsc 零错误。视觉证据：A1/A5 截图（顶栏 + 三段侧栏 + 聊天头部条）。

**仍未对齐（下一批）**：①聊天区创作助手/创作流程面板（设计稿为干净对话 + composer，创作流程按资料完整性自动判断）——涉及 `LessonConversationChat`/`CourseChatPanel` 结构改造；②内容区内部编辑器工具条（设计稿的编辑/试运行工具条 + 场景与状态导航）——编辑器内部大改，需单独立项。


### 教师四条指示落地（2026-09-17 21:50，V3.1 全面对齐）

Owner 21:03 四条指示（均以 `双形态UI设计/v3` 设计稿为依据）逐条落地：

**① 左侧只有两大部分，取消"课例"概念**
- 删除整个「课例与对话」导航段（含课例列表、课例内联新建表单、课例对话导航 `LessonConversationNavigation` 使用点）；左栏现仅「资源管理器」（树状，Windows 资源管理器式）+「项目与会话」（项目分组会话为主，底部工作空间会话，向下滚动可达）。
- 课例上下文代码全部保留，入口改为：树中点 `.h5lesson`（已登记课例直接 `activate()`，材料/课例对话/自动继续全链路）与「更多 → 新建课例 / 打开课例 / 作为独立副本打开」。
- `LessonConversationNavigation.tsx` 组件文件保留但已无 UI 调用方；`search-conversations` 合同操作保留。

**② 内容区对齐设计稿（轻量编辑 + 全屏编辑器）**
- 内容区布局条新增「在编辑器中打开」：全屏编辑模式（`data-editor-focus` CSS 隐藏侧栏/对话/分隔线，DOM 保持挂载，Path C 编辑器连续性探针不受影响），「返回工作台」恢复进入前的工作台布局偏好（暂存/恢复机制同设计稿 `setEditor`）。
- 编辑器内部工具条瘦身（设计稿的编辑/试运行工具条）未做——编辑器模块深度改造，建议单独立项。

**③ 启动默认打开上次工作空间 + 左上角切换器**
- `openWorkspace` 成功后写入 `localStorage['guoling-last-workspace']`；启动时 recent 列表到达后自动打开记录中的工作空间（记录失效静默留着陆页，e2e 新 profile 行为不变）。
- 顶栏左侧改为工作空间切换器（品牌 + 当前工作空间名 + chevron），弹出层 = 最近工作空间列表（含路径、当前项高亮）+「选择其他工作空间文件夹…」+「新建工作空间」+ 权限说明，替换原 identity 文案块与「切换工作空间」按钮。

**④ 内容区默认关闭 + WPS 式页面标签**
- `contentClosed` 默认 `true`；打开文件/激活课例时自动展开（视图 effect：课例或会话身份变化即展开，不打扰手动收起）。
- 内容标签行：课件标签显示课件真实名（`basename(projectPath)` 去 `.h5lesson`，未绑定时「新建课件」），标签行尾「＋」弹出「新建 Markdown 文档（内联命名、自动补 .md，真实落盘经新合同 `create-file`）/ 新建课件（弹模态框）」。
- 新建课例 / 作为独立副本打开改为居中模态对话框（遮罩点击关闭）；「新建课例」主按钮从顶栏移除，收纳进「更多」菜单。

**测试与验证**
- 四件套 Path A/B/C + NavHierarchy 全绿（2.4m 同跑）；三套 tsc 零错误；`build:renderer` + `build:electron` 均已重打。
- 测试修复：Path A 重开段改为"自动回到上次工作空间"断言；Path B 新建课例走更多菜单 + 模态框；Path C 课例激活改树点 h5lesson、重载后免选手动重开、课件 tab 名正则；NavHierarchy 断言两段式。
- **删除 `tests/e2e/r19ConversationNavigation.spec.ts`**：被测面「课例对话导航」region 随课例段取消整体移除，分支/删除能力已由 `DirectorySessionList` 覆盖（git 历史可恢复）。
- 12 份 Luna/CLI 规格静态适配（新建课例/打开课例入口、课例列表点击 → 更多菜单/打开课例对话框/树激活），**未实跑**：受环境通道限制；其中 5 份（ExistingMechanism / LessonContinuation / ManualContrast / TeacherRetainedHigh / TeacherRetainedClaudeDeepSeek）原依赖「课例对话导航」选择**指定**会话，现激活后自动接最近会话，指定会话选择能力待新会话切换器设计落地后恢复（已在各 spec 注释标注）。
- 证据：`2026-09-17-frontend-special-evidence/C1-editor-in-workbench.png`（新顶栏切换器 + 两段式侧栏 + 课件名标签 + ＋新建 + 在编辑器中打开）。

**遗留（下一批）**：①编辑器内部工具条按设计稿瘦身；②聊天区创作助手/创作流程面板形态；③课例多会话的指定切换 UI（随新会话切换器设计）。

### 教师第二批反馈落地（2026-09-17 22:45）

Owner 22:14 四条反馈逐条落地：

**① 项目中无法进行新对话（发送报"当前工作空间对话不存在，请重新打开"）**
- 根因：`src/main/localAgent/service.ts` 对 `workspace.kind === 'directory'` 的会话，原来只用 `workspaceRoot: normalizedDirectory` 反查归属；项目分组会话的真实记录 `workspaceRoot` 是工作空间根、另有 `projectPath`，反查必失败即抛错。
- 修复：回退改为 `conversationRepository.listAll()` 按 `conversationId` 定位真实记录，并以 `conversationOwnerOf(found)` 取得真实 owner 后再 `attachSession`。主进程已重打（`build:electron`）。

**② 布局弹出层看不见（白底白字）**
- 根因：顶栏 `.lesson-workspace-toolbar button { color: #f4f1ea }` 污染到 `.lesson-layout-popover` 内按钮（浅色弹出层上的近白文字）。
- 修复：`lessonWorkspaceShell.css` 对 `.lesson-layout-popover>button`、`.lesson-layout-dock>button` 显式覆写（surface 底、ink 字、边框、hover、aria-pressed），布局停靠面板改双列网格居中。

**③ 切换工作空间提示 + 「更多」菜单删除**
- 切换器 summary 增加「⇄ 切换」胶囊标签，入口含义明确。
- 整个「更多」`<details>` 菜单删除（含 新建课例/打开课例/作为独立副本打开 入口）；「打开课例/副本」合同能力保留在 controller，待新入口设计。「课例」命名统一退出 UI：模态框改「新建课件 / 课件名称 / 创建课件」，空对话区新增「新建课件」主入口按钮。

**④ 拖拽方向反转 + 属性栏拥挤**
- 内容区分隔线拖拽符号修正：`dock === 'bottom'` 时翻转（几何验证：内容在分隔线上方时向下拖应增大不翻、下方时向下拖应缩小才翻；left 翻、right/top 不翻）。
- 属性栏拥挤：内容区默认宽约 46% + 标签行/布局条占高，编辑器内部按大屏设计故显挤。当前版本的正解是「在编辑器中打开」全屏深编辑；编辑器内部工具条按设计稿瘦身是下一批改造项，本轮不动。

**测试适配与回归**
- 13 份 spec 适配：Path B/C 与 ScannedMaterial、LessonWorkspace 创建段走空对话区「新建课件」；LessonWorkspace 重载段改为重载前经 desktopAPI 真实建 `course.h5lesson` + `bind-project`、重载后目录树点选激活（首个保存绑定断言因此平凡通过，已注释说明）；副本 spec（`r19LessonCopyMove.spec.ts`）整体 `test.skip`（asCopy 合同能力保留）；9 份 Luna/CLI 保留 profile 规格启动处改为「按钮可见才点/等工具栏」（自动打开上次工作空间）、课例激活统一改目录树点选（文件夹 + `basename(projectPath)`）。**Luna 规格未实跑**（通道限制），仅静态适配。
- 树选择器修正：新版资源管理器树有 `展开 …` chevron 按钮，`/串联电路/` 正则命中两个元素，改 `exact: true` 命中行按钮。
- 「专业/简洁」模式切换已不存在于产品 UI（V3.1 瘦身的残留），LessonWorkspace 的另存为段移除模式切换步骤；**注意**：`r19LessonDelivery.spec.ts` narrow-mode 段及各 r18/editor/stabilization 旧规格仍引用该按钮，待 narrow-mode 现状梳理后统一恢复，本轮未改。
- 回归：`build:renderer` + `build:electron` + 三套 tsc 零错误；Path A/B/C + NavHierarchy 四件套全绿（2.5m）；`r19LessonWorkspace` 绿（59.9s）；`r19ScannedMaterial` 绿（25.7s）；`r19LessonCopyMove` 按预期 skipped。

**遗留（下一批）**：①编辑器内部工具条按设计稿瘦身（含属性栏密度）；②聊天区创作流程面板形态与多会话指定切换 UI；③依赖「专业/简洁」模式按钮的旧规格（含 r19LessonDelivery narrow-mode 段）恢复。

### 目录作用域对话 = 完整 CLI 套皮（2026-09-17 23:55，F02）

Owner 23:34 定调：未定位具体文件/页面/对象时，工作空间与项目会话都是完整 CLI 套皮，工作空间/项目文件夹即 CLI 的 workspace；只有选择具体文件、页面、对象时才触发上下文路径。

- 根因：V3.1 导航把项目/工作空间会话接上 `DirectoryConversationChat`（共用 `LessonDiscussion`），但其发送无差别走 `lesson-start`/`lesson-resume`；主进程这两个操作原来无条件要求课例上下文（`currentLesson`），目录作用域必抛「课例上下文不可用」。23:23 的报错即此（22:14 修复只把失败从"找不到对话"推进到这一步）。
- 修复（仅主进程 `src/main/localAgent/service.ts`）：`lesson-start`/`lesson-resume` 按作用域分流——课例作用域保持课例提示词；目录作用域教师消息**原样**交给 CLI（裸提示词，套皮），harness 对 directory 作用域原生 cwd 取 `realpath(normalizedDirectory)`（工作空间根或项目文件夹），会话归属/绑定/停止/输入链路不变。选择具体文件的上下文路径（编辑当前文档、激活课件）不受影响，本就按 kind 分流。
- 验证：新增门控冒烟 `tests/e2e/r19DirectoryConversationCli.spec.ts`（`R19_DIRECTORY_CLI_RUN=1`，真实一轮最短 Luna 对话）：工作空间会话发送 → 助手真实回复 → 记录作用域断言为 directory 且目录=工作空间根。**已实跑通过（18.6s）**。`build:electron` 通过；四件套 Path A/B/C + NavHierarchy 回归全绿（2.5m）。
- 备注：聊天面板头部仍显示课例向文案（「创作助手」「说明教学主题…」、region 名「课例创作助手」），目录会话的文案品牌化随下一批界面打磨处理，不影响功能。

### 对话面板底部化 + 权限现状确认（2026-09-17 深夜批）

- **CLI/模型/强度选择器移到输入区上方一行**（`LessonConversationChat.tsx` + `course-chat.css` 新增 `.chat-composer-controls`）：头部只留「创作助手」标题，`CLI` 选择 + `CLI 模型配置`（模型/强度/速度/刷新）移至底部 composer 行，与主流 agent 一致。可访问名全部不变（`CLI`、`CLI 模型配置`、`给创作助手的消息`），既有 spec 选择器不受影响。目验截图：`output/r19-directory-cli/<ts>/directory-conversation-composer.png`；冒烟 `r19DirectoryConversationCli` 重跑通过（21.6s），渲染层构建 + e2e tsc 通过。
- **权限现状（Owner 问「权限设置好了吗」）——未设置**：左下角「工作空间内完整权限 / 外部默认只读 · 其他操作需授权」目前是设计声明标签，无接线。三个适配器（Codex app-server / Claude / OpenCode ACP）的授权请求一律转为聊天内提问（允许一次/允许本会话/拒绝），无按工作空间边界的自动放行。要实现「工作空间内默认全权限、外部需授权」需按适配器分别接审批策略（Codex approvalPolicy、Claude permission_mode、OpenCode 会话权限）+ 工作空间边界判定，属自动放行类敏感改造，待 Owner 确认方案后单独立项。
