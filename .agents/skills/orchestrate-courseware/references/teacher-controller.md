# 教师控制台

新课已有教师控制台，承担步骤、场景、目录、缩放和声音操作；不要在页面里再写一套导航。配色未明确指定时沿用课程主题的 `--color-background`、`--color-text`、`--color-accent`。普通外观先在编辑器现有设置中调整；只有确需改变控制台结构时，才读取 `controller/教师控制台.js` 并局部修改。

控制台是宿主授权的唯一全局控制角色。保留现有 `CoursewareComponent.define`、身份、API 版本及生命周期，使用 `ctx.teacherController`，不从页面 DOM 或全局变量推测课程状态。

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
