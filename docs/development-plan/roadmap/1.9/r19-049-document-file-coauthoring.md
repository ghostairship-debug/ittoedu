# r19-049-document-file-coauthoring：普通Markdown文件编辑、恢复与AI共编

- Release: 1.9
- Dependencies: `r19-042-draft-workspace-continuity`, `r19-041-session-navigation`, `r19-047-shared-document-editor`
- Optional: 否
- Write locks: `contracts-schema`, `main-preload`, `ai-session`, `chat-ui`, `workspace-shell`, `app-save-recovery`

日期：2026-09-18。本文是目标规格，当前实施次序、事实和验收统一见[完整实施方案](../../R19_FRONTEND_SPECIAL_IMPLEMENTATION_PLAN.md)；本轮仅文档重建。

## 目标与现状
根目录或项目里的普通 Markdown 可直接打开、手改、AI 改稿、保存重开与部分撤回，不要求课例引用或四阶段角色。复用047正文核心及既有文件会话；补目录聊天 documentTarget 真实接线。对应 F04，V04/V07/V09。

## 直接入口与职责
renderer documentFiles/documentFileSession、LessonDocumentEditor、shared/document/ports、lessonDocumentAiTask；main lessonDocumentFiles、lessonDocumentDesktopService、lessonDocumentCoauthoring、lessonDocumentAiTask。路径从当前源码核对，IPC与Chat由集成人改。041管容器，049管文件会话/I/O/恢复，044仅消费任务制品版本。

## 执行与退出
1. ordinary file ref 从目录作用域贯穿 open/watch/save/prepare/apply/revert；真实路径、磁盘版本、附件、范围与 epoch 有严格合同，不造 lesson 身份适配空壳。
2. 排版/源文共用当前稿；中文 IME 完成后自动保存，Ctrl+S/发送/关闭 flush；显示未保存/保存中/成功/冲突/失败/恢复真实状态。
3. CAS＋同目录暂存替换，附件先落盘，跨文件失败有恢复记录；外部变更三方比较，删除保留草稿，恢复写入失败不自动关闭丢稿。
4. AI 基于冻结当前稿应用无冲突部分并记录，后续手改优先；选择性撤回仅逆转可靠对应部分，范围外保持。实际保存、实际应用、建议和失败分开。
5. 文件 session 不因停靠、全屏或内容区隐藏而销毁；文档 history 不接管工程 History。CLI 外部写盘走观察/冲突，不冒称宿主提交。
6. 用户要求审稿才提供当前文件/附件批准版本；无固定阶段字段才能编辑。Office 原格式编辑不在本节点，不能用 Markdown 转换冒充。

## 验收与交接
普通根目录/项目 MD → 中文/公式与源文往返 → AI 实改 → 用户同处改动 → 部分撤回 → 保存重开；外部冲突、坏扩展、附件失败、取消/切目标、恢复稿真实保全。复用 documentFileSession、lessonDocumentFiles/Coauthoring/AiTask 单元与对应 E2E；测试新增普通 file ref，无模型 I/O 先证伪，真实 AI 接线与050共用一次有效任务。
