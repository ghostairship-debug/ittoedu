# r19-042-draft-workspace-continuity：目录归属与文件编辑身份连续性

- Release: 1.9
- Dependencies: `r19-040-session-persistence-deletion`
- Optional: 否
- Write locks: `contracts-schema`, `ai-session`, `app-save-recovery`, `chat-ui`, `main-preload`
- Gaps: G09

日期：2026-09-18。本文是目标规格，当前实施次序、事实和验收统一见[完整实施方案](../../R19_FRONTEND_SPECIAL_IMPLEMENTATION_PLAN.md)；本轮仅文档重建。

## 目标与现状
工作空间/项目目录独立承载会话，文件打开才形成当前编辑上下文；首次保存不断对话，Save As 隔离工程执行身份。无需 lesson.json、固定四稿或 .h5lesson 才开始。对应 F01，V01/V02/V04。

## 直接入口与职责
shared/workspaceIdentity.ts、lessonWorkspace/lessonDesktopContract、localAgentTaskContract；main/lessonWorkspace、lessonDesktopService、localAgent/service 与 renderer 工程打开/保存生命周期。复用040记录、049文件会话；共享 strict Schema、IPC/main/preload/renderer 在同一可运行批次切换，不能只放宽一端。

## 执行与退出
1. 统一 workspaceRoot/projectPath 规范化及目录关系；按真实 scope 设置 cwd 和读取 owner。文件引用、消息目标与目录权限分开，标签不等于 CLI 权限生效。
2. 发送冻结真实文件/工程身份、范围、revision/磁盘版本和 epoch；焦点改变只影响后续消息，旧候选不能应用到当前新文件。
3. 真正未保存工程首次保存只绑定文件并失效旧 epoch，观察新目标再接续。取消/失败保持工程、草稿和会话，测试不得提前 bind 后声称首存通过。
4. Save As 新建工程编辑身份；不复制旧候选、工程专属会话执行句柄/trace/提交历史。目录对话可以继续，但消息仍标注原目标；原历史可查看，新任务重新观察。
5. 外部目录另存不迁移当前 cwd 或会话归属；改名/移动更新实际文件引用和恢复定位，复制不复制执行记录。目录移动需核实来源并显式重关联，同名/外部副本不能自动合并。
6. 未知/旧记录不静默解释为新身份；本次无兼容要求不能用于清空真实文件或恢复稿。错误、权限/创建失败须反馈实际结果。

## 验收与交接
两个同名目录和同名课件隔离；无工程对话/重启；真实首存/取消/失败；目录内外 Save As；文件重命名/移动/复制与保存冲突；发送后换文件/切根/停止和迟到候选。先证明共享归属与版本规则，再用一条连续工作台链证明真实保存/重开。CopyMove 的 skip 不算证据，恢复相关命名用例后才能计完成。
