# 工作台工程检查点（2026-09-23 04:55 +08）

这是实际工程证据记录，不是完整 B07/B12 或 Owner accepted。正式候选构建 `npm run build:desktop` 已于 04:42 左右通过，日志 `output/g20/b07/build-m01-m02-m03-m07-m10.log`；后续 M04/M08/M09 仍在开发，不将该旧构建宣称最终候选。

| 正式场景 | 当前结论 | 实际行为与证据 |
|---|---|---|
| M01-T01 空间真正释放 | passed | `g20ExecutionUI.spec.ts` 在生成中收起 AI、再收起资源区，内容实际 bounding box 分别增宽超过 150 / 300 px；恢复入口可点击。 |
| M01-T03 运行中隐藏 | passed | 同一实际 Electron + HTTP 夹具任务中多次收展，模型请求数保持 2，未发送输入保留、原位预览仍显示，之后正常一次提交和停止下一任务；完整测试 1/1 passed，48.1 秒。日志/JSON `output/g20/b07/assistant-m01-layout.*`，截图和状态 `output/g20/b03/execution-ui/run-UdqMmI/`。不是实际供应商测试。 |
| M01-T02 拖拽与持久化 | passed | `g20WorkbenchLayout.spec.ts` 两用例真实拖动资源分隔条 240→305 px，关闭并重新启动 Electron 同一 profile，恢复 305 px；缩小后内容不横向越界。 |
| M01-T04 缩放与重挂载 | passed | 上述两用例在 Windows 分别使用 Electron `--force-device-scale-factor=1.25` / `1.5`，实测 devicePixelRatio 匹配；正常与窄窗口中进入/返回深度编辑，保留同一 documentId。窄视口实际宽度 640 / 638 px，页面 scrollWidth 与视口相等，关键按钮可见且可操作。**这是 Windows 上应用进程的 DPI 覆盖验证，没有改全系统显示设置。** 两用例分别 23.7 / 22.7 秒通过；截图已人工查看。日志/JSON `output/g20/b07/layout-and-b01-history.*` 同次包含另一个历史用例失败，不能把整命令报全绿；仅本表两个明确通过用例。证据目录 `layout/scale-1.25-Qnksgo/`、`layout/scale-1.5-srGGuR/`。 |
| M01-T05 无文件空态 | passed | `g20WorkbenchDocuments.spec.ts` 无工作目录下新建 MD，保存关闭最后一个标签；会话保留、无永久课件空标签，可再次新建；第二稿放弃后回到空态。截图 `output/g20/b07/documents/run-h6YY7a/empty-after-close.png` 已查看。 |
| M02-T03 关闭确认 | passed | 同一用例实际通过正文源文编辑输入，关闭选择取消、保存但原生 SaveDialog 取消都保留未保存正文和标签；保存并关闭写入真实新文件；第二份脏稿选择放弃可关闭。1/1 passed，28.1 秒；`output/g20/b07/workbench-integrated-selectors.*` 同次另一用例失败，统计仅此明确通过项。 |

补充：Main 的关闭/删除屏障 `g20DocumentCloseFlow.test.ts` 与 `g20WorkspaceTrashFlow.test.ts` 共 3/3 passed（`output/g20/b01/close-trash-barriers.log`），含确认期间人工新修改拒绝错误丢弃、取消零删除、确认后停止旧写任务、未保存正文/History 改为未命名保存且原路径不复活。删除测试用真实磁盘 rename 模拟回收站端口，**尚不是系统回收站 Electron 验收 M10-T05**。

首轮界面测试的入口/脏标签选择器已按新 UI 修正；加入 build 工具后，旧 HTTP 夹具按首个 content 字段错选 build.write，现按 text.replace 的 target/string-content schema 精确匹配。对应失败日志保留，不算 flaky 重跑。Markdown 正文生成预览目前仍显示原 Markdown 符号、继承标题字号；该实际视觉缺口留给 M06，不因布局用例通过而宣布正文视觉验收通过。

M02 其他场景、M03 完整三表面轻改和深度高级能力、M07 全部队列/IME真实界面、M10 全部文件操作仍需后续正式用例。Owner 产品评价与最终签署未执行。

## 05:49 增量：保存界面、正文预览和候选构建

- `npm run build:desktop` 在 05:44 通过，日志 `output/g20/b07/build-s11-m06-s14-integrated.log`。此候选包含 S11 旧内嵌 CLI/Main/聊天/MD candidate/IPC 的实际删除、M06 结构化正文与内部光标修复、S14 图片结果正式 IPC。后续 S04 第17批、S05能力探针、M12/M14仍在推进，不能称最终候选。
- **M11-T03 passed**：`g20M11DocumentExperience.spec.ts` 的 `M11 real header failure/retry and per-location external Markdown conflict` 实际 Electron 通过，13.196 秒。对真实磁盘先验证非重叠 `Ax/B/Cy` 自动合并并保存，再验证重叠只采用该处磁盘稿，其他教师与外部修改均保留，最终 `Ax disk/B teacher/Cy external`。结果在 `output/g20/b07/m08-m06-m11-current.json`（同批另3项失败，不能称整批通过）；截图 `output/g20/m11/run-UqmbxE/saved-merged.png` 已查看。该用例还验证保存失败后当前稿保留和随后成功清除失败状态，但未独自覆盖 M11-T01 全部恢复/生成状态。
- **M11-T05 passed**：Windows真实只读文件导致第二份保存的原子 rename 返回 EPERM；首稿已写盘，失败稿与第三稿仍为 dirty，三个标签及正文全部保留，焦点转到失败稿，窗口未关闭。`g20M11DocumentExperience.spec.ts` 精确第二项通过，16.189 秒，`output/g20/b07/m08-m11-corrected.json`；同批剪贴板项失败。截图 `output/g20/m11/exit-v2VNyM/exit-save-failed.png` 已查看。首次测试错误把隐藏bootstrap课件计为可见MD标签，原失败保留；修正为三个实际MD后通过。截图也发现原始EPERM路径挤占标题，源码随后改为简短人类可读原因，下一UI批验证展示。
- **M06 已修复且原 GUI 回归通过**：原失败中预览将内部 caret 移到首标题的 NodeSelection，被误报为教师选择；生成中输入的下一草稿冻结旧 revision，导致后续正常发送受阻。现在只有真实用户选择事务发布 M04 context，内部预览与纯 decoration 不发布；`g20PreviewSelectionOrigin.test.tsx` 1/1通过。真实 `g20ExecutionUI.spec.ts` 随后 1/1 通过、49.8秒，结果在 `output/g20/b07/s11-m06-m04-s14-gui.json`（同批另3项入口/启动fixture失败）。包括未保存MD真实HTTP Engine读取、正文增量、折叠保留、单History提交、第二次发送、停止迟到输出；不是实际收费模型证据。结构化正文呈现已无原始Markdown符号和继承标题字号，旧04:55视觉缺口已修复。
- **当前仍未通过**：M08真实Windows图片粘贴、预览已到达，纯附件发送发现产品未提供视觉能力验证入口、unknown永久阻断；首轮启动reload竞态与测试直接声明capabilities被正确拒绝均保留，不算发送通过。S05正在补正式探针，原Windows剪贴板每轮均恢复。M04两用例首次在firstWindow前resize失败；S14首次使用过时空间入口失败，均未进入待证明链，修正fixture后正在重跑。不以测试发现、静态检查或可执行脚本代替GUI通过。
