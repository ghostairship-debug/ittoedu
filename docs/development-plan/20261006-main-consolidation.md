# 2026-10-06 main 归并与工作树清理

正式开发目录现在为 `D:/果铃工作台`，分支为 `main`。已验证候选 `125d52fd` 从原 main `64d97fa2` 快进合入，包含其间 200 个提交；本次没有将旧分片的未完成实现重新叠加到产品源码。

原 main 的 929 项既存状态先保全。完整源码快照另提交为 `a99b95bb`，保留在 `archive/main-before-v10-20261006`。main 原有已获 Owner 确认的 AGENTS.md 原样带入；本次没有增加或改写其规则。

## 清理与保全

- 109 个原工作树 HEAD 均保留在 `refs/archive/20261006-main-consolidation/<编号>/head`；33 个未提交源码快照保存在对应 `snapshot` 引用。39 个残留 Git 索引也另存为可追溯的 staged-indices tree 引用，避免清理缺失工作树登记时丢掉暂存成果。
- 108 个辅助工作树登记已清理：85 个实际目录移除，23 个原已缺失登记剪除。另移除 19 个空父目录。Git 只剩 `D:/果铃工作台` 的 main 工作树。
- 删除前逐一断开目录连接；保留 main 的实际依赖目录。仅关闭已定位到旧目录的遗留编译/验收进程，未终止通用 Codex、Node 或浏览器会话。
- 本地资料保存在 `D:/果铃工作台/docs/archive/local/20261006-main-consolidation`，其中 `preservation.json` 对应原路径、Git 引用和 materials 位置；`removal.json` 记录实际清理结果。可再生依赖及 dist 缓存不逐树复制。
- 用户课件、素材、历史样本和独立验证证据保留。main 的 scratch 作为本地用户材料排除于源码提交；两个临时 `.audit-3way` 目录归档到 `main-local`。
- R2/R3/R4 原工作树内的检查记录迁到 `D:/果铃工作台/docs/archive/local/evidence/20261006-required-evidence/integration/leaf-checks`，已修正[上一批结果报告](20261006-required-fixes-result.md)的实际链接。

## 最小验证与剩余边界

产品源码、脚本、测试、package/lockfile 和 Vite 配置与候选 `125d52fd` 一致；AGENTS.md 与原 main 的 Owner 快照一致。已验证制品迁入主目录，没有因目录整理重跑构建、真实模型或全测试矩阵。

主目录的正式 `launch-mcp-server` 已用独立 profile/workspace 实际启动；公共 SDK 的 `workbench.state` 正常，后台 mode 为 headless，detach 后经 owned IPC 正常退出（exit 0、Main 进程释放）。记录为归档目录的 `main-smoke.json`；检查模型调用为 0。用户级四个课件 Skill 已核当前版本，现有 editorRoot 绑定为 `D:/果铃工作台`。

本次只证明主线归并、路径收拢和新目录启动属性。上一批有效保存/冷开/导出及性能证据继续适用；原类型/测试维护债和历史 native 根因未完全验证仍见上一批结果，不把合入 main 当作它们已清零。发布继续暂停，本次未推送远端。
