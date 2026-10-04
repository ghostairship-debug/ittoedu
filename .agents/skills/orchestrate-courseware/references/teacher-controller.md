# 教师控制台与自定义导航

新课已有教师控制台，默认承担步骤、场景、目录、缩放和声音操作。用户没有特殊导航设计时直接复用；有明确要求时，自行比较深度改造与独立重写，选择更方便实现和维护的方式。独立导航应关闭默认控制台，避免重复入口；可以用页面布局、独立组件或导航程序适配用户设计。导航属于创作内容，不限制为固定按钮排列或默认外观。

改造控制台时先读取 `controller/教师控制台.js`，可以局部修改，也可以重写其界面结构与行为。配色未明确指定时沿用课程主题的 `--color-background`、`--color-text`、`--color-accent`。自定义导航需要控制工程场景、步骤或目录时，可以复用下列宿主接口；自包含程序采用自己的导航时，按实际载体实现并检查用户要求的路径。

关闭默认控制台用 `project.delete {path:"controller/教师控制台.js"}`，这是可撤销的工程修改，不删除独立导航。需要恢复时，可以将此前读取的源码用 `project.write` 写回同一路径，软件重新建立控制角色；不要另建第二份默认控制器。普通页面跳转也可直接使用相对链接，由软件接入正式导航。

改造现有控制台时，它仍是宿主授权的唯一全局控制角色。保留现有 `CoursewareComponent.define`、身份、API 版本及生命周期，使用 `ctx.teacherController`，不从页面 DOM 或全局变量推测课程状态。普通页面和独立程序不自动取得这个角色。

| 入口 | 用途 |
|---|---|
| `read()` | 当前场景列表、进度、位置、缩放、静音、全屏、收起和偏移 |
| `subscribe(render)` | 状态变化时刷新；返回取消订阅函数，销毁时调用 |
| `canExecute(action)` | 按当前状态决定按钮可用性 |
| `execute(action)` | 执行正式导航或声音/全屏动作，返回 `Promise<boolean>` |
| `setCollapsed(value)` | 收起或展开 |
| `moveBy(dx,dy)` | 拖动控制台 |
| `setZoom(value)` / `resetView()` | 调整或恢复视图 |

动作使用现有对象，例如 `{type:"step.next"}`、`{type:"step.previous"}`、`{type:"scene.next"}`、`{type:"scene.previous"}`、`{type:"scene.replay"}`、`{type:"course.restart"}`、`{type:"audio.toggle-mute"}`、`{type:"player.fullscreen.toggle"}`。跳指定场景时，把 `read().scenes` 中实际的 `id` 交给 `{type:"scene.go",sceneId}`；这些身份来自软件，无需写进课件内容。

写回经过现有组件准入，失败保留诊断。检查时确认上一步、下一步和目录仍能操作；键盘与翻页笔使用同一播放逻辑。
