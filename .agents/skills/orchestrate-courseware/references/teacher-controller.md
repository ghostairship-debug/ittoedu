# 教学导航、正式控制与可选教师台

新课同时设计内容主路径、页内推进、页间衔接和实际需要的返回。按内容选标签、目录、翻页、地图、混合或其他形式，融入主题和构图，不将外加底部上一步/下一步条当作品导航。新作不默认完整教师台或宿主外底栏；按需求复用正式动作、原生按钮/标签、小代码片段或局部导航程序，不预读长源码。主流程还须由明确的鼠标/触摸内容动作产生真实结果并自然承接，键盘只作附加入口；仅改名或点亮“下一步”不构成沉浸式推进。

在现有策划中说明动作改变什么、结果怎样展开下一段或进入哪里、何时需要返回；不套统一闯关、逐页登记或每页按钮模板。采用目录时才将真实场景/状态/标题/镜头组织为必要入口；按用户当前指令继续，不固定策划/框架确认。

持续导航默认只在全局层设计一个实例，外观、位置、目录分组、文案与状态样式在整作策划中确定一次。通过 `project.list` 取得实际 `global/overlay.json` 结构路径后，可用 `project.apply {path:"global/overlay.json",intent:"insert",region:实际导航区域,content:导航HTML}` 直接装配；区域按本作真实构图，不用整页透明壳吞掉正文点击。每次跳页更新同一导航的当前状态，不向各页复制一套目录或监听。软件维护正式场景列表、目标引用、键盘语义和清理，模型不维护第二套页序、页码和键盘脚本。

常用操作在课内保持稳定、容易发现，不能频繁拖走/展开/收起控制台才能阅读主要内容。可减少无关控件、把入口融入页面布局；不为兜底台规定统一安全区或开发智能避让。拖动、固定视口、收展是选用能力，不因组件承担导航就自动附加。

完整台保留人工添加、用户明确要求及既有作品的合法使用。修改旧工程保留未要求改动的导航；仅实际选择/修改完整台时，才通过 `project.list` 找到 `global/overlay/` 中该实例 `.data.json` 和源码路径并 `project.read`。实例源码只影响当前实例，`components/` 的共享定义影响引用者，应按授权范围处理。AI 新作工厂不再自动插入可见完整台属于软件修复，不是要求模型逐课重复删除的长期步骤。

## 当前实际接口的使用边界

下列为组件运行上下文 `teacherController` 的当前端口。宿主按挂载实例绑定界面状态，共享课程进度、导航和视图；源码组件使用上下文提供的端口，不自行调用 `forInstance` 或寻找其他实例。普通导航/HUD 仍受学生导航守卫和当前运行权限约束，不因显示在全局层、使用该端口或改为源码而取得教师强制跳转权限。实际可用性以本次上下文及回执为准。

默认实现可在读回数据中将 `enabled` 改为 `false`，通过 `project.apply` 写回同一 `.data.json`；恢复为 `true`，这是可撤销正式修改。自定义源码仅在确实解释此字段时才采用，不能假设所有私有程序支持同一开关，也不删除源码或人工布局。

沿现 `mount`、`update`、`dispose` 生命周期使用实际端口，不从页面 DOM 或全局变量猜课程状态；几何、资源、身份由软件维护，不访问未开放文件、凭据或系统接口。

这些端口属于 API5 源码实现的 `mount(context)` 参数，普通 HTML 内的 `<script>` 没有 `window.runtimeContext`、`teacherController` 或 `courseState` 全局。普通 HTML 的定制导航用 `const navigation = await window.courseNavigationReady` 取得软件注入的正式导航子集：`read()`、`readLocation()`、`subscribe(sync)`、`canExecute(action)` 和 `execute(action)`。从 `read().scenes` 取得真实场景与显示名称，调用 `{type:"step.next"}`、`{type:"step.previous"}` 或 `{type:"scene.go",sceneId:实际场景id}`；首次显示读取当前值，再订阅后续变化。订阅由宿主生命周期清理，局部提前退出或替换界面时也调用返回的取消函数。端口尚未接通时保留实际错误，不叠加默认教师台或退回自写翻页脚本。

新建独立内容链接时，可在 `object.insert` 一并带 `click:{action:"location-go",value:"已观察的目的页面句柄"}`，跨页已有目的地的入口同批创建；软件生成绑定，不另写导航程序。独立对象只需点击跳到已知页面时，可直接用 `interaction.update {target:"已观察的独立对象句柄",change:{kind:"click",action:"location-go",value:"已观察的目的页面句柄"}}` 绑定正式动作，不必改成 Source。程序需要共享课程结果或其他源码端口时，再沿实际局部程序入口使用宿主能力：先 `project.list` 找该实例实际 `.view.js/.view.ts` 和内容/数据文件，再读写短作者入口，保留其实际 import；入口回执note已提供常用API事实，普通接线不先翻完整框架依赖；软件维护工程共享依赖，完整源码按需从 `.dependencies/` 读取。复用 Web 时保留导入实现的 `document:'web'` 声明，并在 `await implementation.mount(context)` 后接所需局部行为；写回形成实例私有实现，其他实例及共享定义保持原有内容。沿 `context.scope.state.get/set/subscribe` 或 `context.interactions?.courseState` 使用实际课程状态，沿 `context.teacherController` 导航，不猜另页 DOM 或全局桥。

| 入口 | 用途 |
|---|---|
| `read()` | 共享场景列表及状态/镜头/标题目标、进度、缩放、静音、全屏；`collapsed` 属于当前实例，`camera` 有则为当前会话镜头 |
| `subscribe(render)` | 状态变化时刷新；返回取消订阅函数，销毁时调用 |
| `canExecute(action)` | 按当前状态决定按钮可用性 |
| `execute(action, signal?)` | 执行正式动作，返回 `Promise<boolean>`；可用 `AbortSignal` 取消本次请求 |
| `setCollapsed(value)` | 设置当前绑定实例的会话收展；自定义界面按 `read().collapsed` 呈现 |
| `moveBy(dx,dy)` | 调整当前绑定界面的会话位移，宿主换算坐标；不写正式 frame、不移动其他实例 |
| `setZoom(value)` / `resetView()` | 调整或恢复视图 |

动作使用现有对象，例如 `{type:"step.next"}`、`{type:"step.previous"}`、`{type:"scene.next"}`、`{type:"scene.previous"}`、`{type:"scene.replay"}`、`{type:"course.restart"}`、`{type:"audio.toggle-mute"}`、`{type:"player.fullscreen.toggle"}`。跳指定场景时，把 `read().scenes` 中实际的 `id` 交给 `{type:"scene.go",sceneId}`；这些身份来自软件，无需写进课件内容。

设计细分目录时，读取场景的 `targets`；每项包含显示名称、类型与宿主提供的 `action`，用 `execute(target.action)` 跳到实际状态、镜头或标题。直接点击场景使用不带细分目标的 `scene.go` 回到该页正式播放起点，包括 Spatial 默认路线。将这些实际目标按本课的章节、问题或实验步骤组织，保留宿主给出的动作对象，不凭标题文字拼接身份，也不自行维护第二份播放顺序。

需要普通过渡时，在导航动作上添加`transition:{effect:"fade"|"slide"|"zoom"|"none",durationMs?,easing?,direction?}`，软件提供默认时序；普通scene.next/previous/go及location.go沿同一导航owner消费。播放态有效可点击原生对象由宿主派生pointer，尊重作者显式cursor；不必逐处补CSS。需要细调时仍可在同一transition提供高级关键帧，由宿主捕获旧/新画面并执行同一次正式导航。例如：

```js
await teacherController.execute({
  type: "scene.next",
  transition: {
    outgoing: { keyframes: [{ opacity: 1 }, { opacity: 0 }], timing: { duration: 220, easing: "ease-out" } },
    incoming: { keyframes: [{ transform: "translateX(24px)", opacity: 0 }, { transform: "translateX(0)", opacity: 1 }], timing: { duration: 300, delay: 40, easing: "ease-out" } }
  }
}, signal);
```

`outgoing`、`incoming` 各自支持 `keyframes`（`transform`、`opacity`、`offset`、`easing`）及 `timing`（毫秒 `duration`、`delay` 和 CSS `easing`）；关键帧可由普通代码生成。转场展示快照，实际运行内容由当前目标页承接；实例保活与当前活动由宿主管理，不以快照承诺任意运行状态恢复，也不要求程序统一暂停或寻帧。浏览器不支持该转场或请求失败时读取实际回执，不声明动画已完成。

当前表面有镜头时，可执行 `{type:"camera.present",pose:{x:120,y:80,zoom:1.4,rotation:0},motion:{durationMs:450,easing:"ease-in-out"}}`。`pose` 的 `zoom` 为正数；`motion.keyframes` 可加入中间 `{offset,pose,easing?}`，`offset` 在 0 与 1 之间严格递增。导航动作也可带 `camera:{durationMs,easing,keyframes}` 控制到目标镜头的有限运动。当前 pose 可从 `read().camera` 获取；这些表现只改变会话视图，不新增作者镜头或路径。新导航、用户镜头操作、Stop/销毁或该请求的取消负责结束和清理，不保存中途进度。

写回沿现正式组件/工程入口，失败保可修输入与诊断。检查实际主路径、选用目标及必要返回；不为验收补目录、重播、全屏、声音、缩放、拖动或收展。键盘/翻页笔与按钮共享实际播放语义。会话位移/收展归当前实例，课程进度归共享 owner；正式位置或初始设置仍通过当前工程文件修改并保存，不把运行中拖动当作人工布局已存盘。

交付说明实际推进方式、采用入口及未完成项，不以换色/换标签宣称结构重设计，也不以深改完整源码作为质量指标。保留角色/权限边界、人工布局及未涉及的既有内容。
