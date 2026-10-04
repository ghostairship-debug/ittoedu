# 在工程里创作

这些是正式课件内容的文件视图，不是磁盘上另一份 HTML。读取包含教师的当前修改；软件负责解析、身份、资源、提交与撤销。

| 路径 | 内容 |
|---|---|
| `theme.css` | 整课共享样式，页面不必复制 |
| `slides/01-导入.html` | 一页一个演示场景，序号表示顺序 |
| `docs/讲义.html` | 连续正文，自然高度，标题提供阅读导航 |
| `components/公转模拟.html` | 独立互动程序，页面用 iframe 引用 |
| `assets/地轴.svg` | SVG 或图片，页面用 img 引用 |
| `controller/教师控制台.js` | 现有教师控制台源码，确有需要时才修改 |

开始框架时，已有工程先 `project.list`。新课用 `file.create` 新建一次 `<课名>.h5lesson`，软件建好空工程与控制台；后续都使用 `project.*`。仅有一个课件时省略 `project`；多个课件时填文件名或路径，不转抄内部句柄。

```json
{"name":"四季的成因.h5lesson"}
```

上例是 `file.create` 的输入。已有用户指定课件则直接使用，不能创建同名文件重做。

写 `theme.css` 和页面用 `project.write {path,content}`。已有文件先 `project.read`；小改用 `project.edit {path,edits:[{old,new}]}`，原文唯一才能定位。原样回写不产生修改。第一张演示页会填入新课初始空白场景；其余新路径生成新场景。改序或改名用 `project.move`，删除用 `project.delete`，引用由软件维护。

页面用熟悉的 HTML/CSS 布局。简单图示可以内联 SVG；待填图片用 `<img src="../assets/地轴.svg" alt="地轴倾斜23.5度的示意图">`；模拟用 `<iframe src="../components/公转模拟.html" title="观察倾斜地轴保持指向不变" height="420"></iframe>`。引用尚未提供时软件显示占位，内容写入后自动填充，不需要登记表。

组件写完整独立 HTML/CSS/JS，由软件做准入并更新引用页。失败时保留草稿及原因，修该组件即可。它自行处理的方向键应调用 `preventDefault()`；没处理的翻页键由宿主接管。页面没有脚本时静态结构可编辑；含脚本的页面允许按整页程序承载，但编辑粒度不同，不要依赖整课脚本切换隐藏页面。

`class="fragment"` 表示按文档顺序逐条出现。步骤、场景、教师控制台、快捷键使用同一播放状态，不自行实现翻页。默认键位：方向键及 PageUp/Down 推进步骤，Shift+方向键切场景，Home/End 到首尾。

修改只进正式工程与恢复稿。需要落盘才 `project.save`，多个工程时填写 `project`。策划 MD 是普通工作区文件，用 `file.write` 保存；它和工程的保存状态分别说明。
