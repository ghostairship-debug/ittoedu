# r19-040-session-persistence-deletion：目录会话恢复、损坏隔离和范围删除

- Release: 1.9
- Dependencies: `r18-060-release`, `r16-020-local-session-store`
- Optional: 否
- Write locks: `chat-ui`, `ai-session`

日期：2026-09-18。本文是目标规格，当前实施次序、事实和验收统一见[完整实施方案](../../R19_FRONTEND_SPECIAL_IMPLEMENTATION_PLAN.md)；本轮仅文档重建。

## 目标与现状
目录是会话归属，文件是消息级编辑目标；无课件也能恢复指定 conversationId。现有持久化、原生记录和目录分流可复用；全局 ID 命中未校验 owner、指定历史难达与轮询全库扫描仍需关闭。落实主方案 F01/F03，对应 V01/V02/V11。

## 直接入口与职责
沿 src/main/localAgent/repository.ts、harness.ts、service.ts、lessonConversationRepository.ts 和 shared/localAgentTaskContract.ts 追踪真实记录；042 提供规范化与编辑身份，041 消费列表和生命周期。具体共享文件由唯一集成人修改，不另建会话仓库。

## 执行与退出
1. 持久记录绑定 workspaceRoot/projectPath/conversationId；start、resume、input、cancel、list、read、rename、archive、delete、恢复都校验同一真实归属。目标文件引用不能代替目录归属。
2. 指定会话读取直达记录；避免轮询 listAll 全量扫描。历史正文按需加载，但不能以减少数据量为由丢失引用、任务或提交结果。
3. 恢复先核对任务终态、原生句柄、当前文件和工程版本。已提交结果不重放；旧 running 或提交结果未知先观察，不假完成、不另造循环。
4. 损坏或未知版本仅隔离对应记录；不实现旧格式迁移，不静默清空目录。归档改变可见性，删除只操作明确范围的应用记录，不删真实文件/附件/恢复稿，也不声称删除原生 CLI 历史。
5. 首存保持目录会话；Save As 不复制目标专属候选/句柄/trace，原目标历史可读。保持当前目录讨论不是复制原工程会话。

## 验收与交接
同名不同目录、根目录/项目、多会话指定切换；无 .h5lesson 重启；损坏一条其余可用；运行中切换/删除/停止，迟到结果不误写；保存/另存后历史归属正确。先做 repository/service 确定性检查，再以真实界面验证精确历史与恢复，原生接续与050共用证据。把仍未知的原生恢复差异交给043，不能用 UI 字符串证明恢复成功。
