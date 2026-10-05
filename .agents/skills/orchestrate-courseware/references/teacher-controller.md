# 教师控制台与自定义导航

新课已有教师控制台，默认承担步骤、场景、目录、缩放和声音操作。用户没有特殊导航设计时直接复用；有明确要求时，自行比较深度改造与独立重写，选择更方便实现和维护的方式。独立导航应关闭默认控制台，避免重复入口；可以用页面布局、独立组件或导航程序适配用户设计。导航属于创作内容，不限制为固定按钮排列或默认外观。

改造控制台时先通过 `project.list` 找到 `global/overlay/` 中实际教师控制台的 `.data.json` 与源码路径，再 `project.read`。可以局部修改，也可以重写其界面结构与行为；对象源码只改当前实例，`components/` 里的源码修改共享定义。配色未明确指定时沿用课程主题。自定义导航需要控制工程场景、步骤或目录时，可以复用下列宿主接口；自包含程序采用自己的导航时，按实际载体实现并检查用户要求的路径。

关闭默认界面时，在读回的数据中将 `enabled` 改为 `false`，再通过 `project.apply {path,content}` 写回该 `.data.json`；恢复时改回 `true`。这是可撤销的工程修改，不删除源码或独立导航。若已自写控制台，则按它实际使用的数据字段控制显示，不假设自定义源码一定解释默认字段。

改造现有控制台时，沿用读取到的模块入口和 `mount`、`update`、`dispose` 生命周期；由软件保留身份与资源归属。使用实际运行上下文的 `teacherController` 端口，不从页面 DOM 或全局变量推测课程状态。自定义组件按宿主提供的端口工作，不访问未开放的文件、登录凭据或系统接口。

| 入口 | 用途 |
|---|---|
| `read()` | 当前场景列表、进度、缩放、静音、全屏和收起状态 |
| `subscribe(render)` | 状态变化时刷新；返回取消订阅函数，销毁时调用 |
| `canExecute(action)` | 按当前状态决定按钮可用性 |
| `execute(action)` | 执行正式导航或声音/全屏动作，返回 `Promise<boolean>` |
| `setCollapsed(value)` | 收起或展开 |
| `moveBy(dx,dy)` | 拖动控制台 |
| `setZoom(value)` / `resetView()` | 调整或恢复视图 |

动作使用现有对象，例如 `{type:"step.next"}`、`{type:"step.previous"}`、`{type:"scene.next"}`、`{type:"scene.previous"}`、`{type:"scene.replay"}`、`{type:"course.restart"}`、`{type:"audio.toggle-mute"}`、`{type:"player.fullscreen.toggle"}`。跳指定场景时，把 `read().scenes` 中实际的 `id` 交给 `{type:"scene.go",sceneId}`；这些身份来自软件，无需写进课件内容。

写回经过现有组件准入，失败保留诊断。检查时确认上一步、下一步和目录仍能操作；键盘与翻页笔使用同一播放逻辑。
