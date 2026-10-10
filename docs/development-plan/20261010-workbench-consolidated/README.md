# 果铃工作台完整可执行方案包

日期：2026-10-10。产品取舍已确认，本包待实施；当前只生成文档，没有开始开发或发布。

主会话、临时卡、人工编辑与外部调用应作用到同一份真实作品。AI 使用熟悉的内容/HTML/CSS表达，人工自由拖拽；软件负责身份、当前稿、资源、固定设计视口装配、版本和正式事务。

最终布局决定是全部采用固定设计比例，不建设跨比例自动重排。编辑、试运行、播放和适用导出的作者画面一致。MCP 默认关闭、主动开启后免令牌，默认与内置 AI 共用权限，连接中可调整为完全访问。

## 文件入口

| 文件 | 用途 |
|---|---|
| [EXECUTION_PLAN.md](EXECUTION_PLAN.md) | 唯一执行规格：最终规则、源码落点、W1—W4任务、依赖、清理、V01—V28验收和完成条件 |
| [START_PROMPT.md](START_PROMPT.md) | 后续授权实施时可直接交给 Codex 的启动指令 |
| [evidence/REVIEW_FACTS.md](evidence/REVIEW_FACTS.md) | 核查事实、证据等级、已复现机制及验证边界 |
| [evidence/verify-execution-file-race.ts](evidence/verify-execution-file-race.ts) | write/patch 原观察依据丢失的基线诊断脚本 |
| [evidence/verify-execution-reply.ts](evidence/verify-execution-reply.ts) | 旧回答/进度/截断被选为新回复的消费者诊断脚本 |
| [PORTABLE_SHARP_DIAGNOSIS.md](PORTABLE_SHARP_DIAGNOSIS.md) | Portable专项报告，实际原生加载根因待证，修复需另行授权 |
| [evidence/ORIGINAL_GPT_PRO_PLAN.md](evidence/ORIGINAL_GPT_PRO_PLAN.md) | 原 GPT Pro 稿完整留存，仅作历史依据，不作执行规则 |
| [MANIFEST.json](MANIFEST.json) | 交付文件完整性清单，不是产品测试或实施完成证明 |

实施无需访问临时上传目录、此前聊天或 /tmp 证据脚本。源码和仓库现行规范仍按实际任务读取。本目录位于仓库 docs/development-plan/ 下，源码链接与诊断脚本的相对导入据此解析；ZIP 不含代码库或依赖。

## 工作收口

W1 先修真实错写与回复串轮，再贯通语义操作、对象互斥及多预览。W2 完成引用、卡片、当前稿确认、输入和导航。W3 完成固定视口原生装配、人改保护及 AI 当前投影往返。W4 完成资料/资源/作业/文件减负和 MCP 同源权限。独立小项可交错，不默认重新审计全仓或跑完整矩阵。

Portable 是独立 P1 支线：诊断完成，Windows 原 EXE/故障机尚未取得；不阻塞 W1—W4。取得专项修复授权与原故障验收前不能写为修复完成。

本包替代原 GPT Pro 草案和本轮讨论中的旧建议：取消卡完成自动选中、跨比例排布、拖拽默认改排序和删除有用会话分类。保留用户文件、未提交成果、原发行件、恢复稿和已完成事实。

没有尚待用户选择的核心产品取舍。当前仅授权生成方案；实施细化在授权范围内自主进行，新的费用/用户数据迁移/远程访问/最终发布按实际要求另行决定。实施事实只进入一个结果入口，不把本次文档生成算产品完成。
