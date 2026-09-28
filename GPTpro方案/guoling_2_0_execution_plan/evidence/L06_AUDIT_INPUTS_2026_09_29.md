# L06 v2.0 审计输入与证据边界

日期：2026-09-29。本页索引方案来源，不是新产品实测报告，不另存任务状态。

## 多轮输入与采纳顺序

1. 仓库 `docs/果铃2.0架构过度防御与体验缺口深度审查报告.md`：Gemini初审，绝对判断须按后续复议修正，不能直接执行原稿。
2. 会话附件 `guoling_gemini_audit_factcheck_2026-09-28.md`：四项初核、OAuth超时、长文恢复、假partial、落盘路径和文件搜索截断。
3. 会话附件 `guoling_second_audit_spark_factcheck_2026-09-28.md`：D01–D28/G1–G14事实与合同核查。
4. 会话附件 `guoling_feedback_review_rel_t11_2026-09-29.md`、`guoling_rel_t11_review_metrics_2026-09-29.json`：普通推理有限重试、目标完成/历史诊断、六段REL统计。
5. 会话附件 `guoling_four_issue_verification_2026-09-29.md`：截图、日常profile日志、三页课件/最后build.write对照与缩减浏览器样例。
6. Owner本轮明确将全部评估和原L06完整方案前移为当前2.0最终闭合项；只改方案至可实施程度。该决定取代旧“封板后再做”时序，不改写原实测事实。

原会话附件此前未写入仓库，本页不声称它们已在本机；全部执行所需裁决已经进入[L06 §20/§21](../long_term/L06.md#s20)，无需重新读完争论才开工。

## 本机直接证据

[B18原范围记录](B18_2026_09_28_M18.md)保留六段接续、首轮失败和最终partial，不是干净首次成功。实际工作区 `output/g20/rel-t11/real-rFSkIy/workspace` 的课件1,258,761 bytes，离线HTML4,069,839 bytes；最后一段tools[80]写入三页Runtime、[81]检查ready、[82]导入applied。原件保留，修复另存副本。

原运行链累计331次请求/416次工具；末段messages图片dataURL约90.7%字节，普通tool-role约2.1%。这是字节比而非token/费用或因果证明。全部日志与有效出处应保留，模型请求工作投影可修剪。

日常 `%APPDATA%/ittoedu-courseware-editor-v8-rebuild` 日志三次closed回调位置对应异常；恢复记录中孤立accepted关联缺失会话。原数据仅作备份后的定点恢复，不清空整个配置。高度/CSP缩减浏览器样例支持机制，不能冒充完整Electron回归。

本次只更新方案和派生文件；新用例均not_run，文档校验不代表上述产品故障已修复。旧38任务/205项通过保留，新增M25–M30及最终Owner签收独立登记。
