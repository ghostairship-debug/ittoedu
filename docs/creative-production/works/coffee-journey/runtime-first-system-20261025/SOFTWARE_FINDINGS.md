# 软件、方法与观测问题记录

本轮未改动并行Codex的产品源码，没有使用旧Portable或历史软件绕过正式链路。咖啡和组件均沿当前构建的DocumentSession / MCP正式事务、保存与导出；未commit/push/发布。

| 问题 | 来源与影响 | 状态 / 证据 |
|---|---|---|
| 章节大背景双重归属 | 作品配置：原生copy不透明底色与Scene Runtime同时切换，形成整块边界 | 已在新r264修正，r263保留；咖啡final截图及formal-pass2 |
| 开篇杯/注释、烘焙标签/底部说明碰撞 | 作品390px构图 | 已按主体配置修正；final与focused实际截图 |
| 离章停播观测超时 | 验证器：离屏iframe的RAF轮询暂停，实际按钮已停播 | 已改定时轮询并复验；focused/interactions.json。不是新增产品停播故障 |
| 原生Flow叶子无独立DOM实例选择器 | 验证器：文字投影为ProseMirror段落，旧选择器找不到 | 用已观察copy组与标题文字进入UI编辑；coldcheck通过 |
| MCP示例名称漂移 | scripts/connect-mcp.ts示例含project.save；当前tools.load报告unknown-tool | 本轮使用实际file.save成功；记录非阻断文档问题，不在并行软件范围内补丁 |
| 配方目标类型易误用 | surface.recipe需要页面句柄；整文档句柄invalid-target | listChildren取得真实页面后成功，已写入资产契约；MCP0030/0034/0035 |
| 原生页白底遮住global underlay | 资产采用的构图前提，不是库插入失败 | surface.configure透明页后背景显现；MCP0044—0046。包不擅自改用户页底 |
| 通用包Source路径较长 | 外部from来源的投影包含较深目录，各次回执反复出现完整路径 | 可用但增加阅读/复制成本；记录候选优化，未为缩路径改核心依赖解析 |
| 当前Luna无vision角色 | 任务冻结配置明确visionUnavailableReason；文本、生成媒体可用不等于视觉审片可用 | 本轮原始条件保留；最终通过外部真实审图判定质量，不能把截图返回当模型看过 |
| Run检查点与实时状态不同 | 观察器先读旧包装/文件检查点，不能代表当前运行全量 | 已改正式execution.run，只读修正，不重发任务、不修改作品；MONITOR_NOTE |
| 原生子Agent远程读无返回 | 本会话子Agent的DevSpace读取长时间挂起，Root同接口可用 | 停止挂起调用，Root取证、子Agent纯文本审查；不虚报并行源码独审 |

咖啡正常编辑、保存、独立冷开、官方离线导出无剩余阻断。长时内存/实体手机热降频未认证，局部控件直接卸载且全局仍存活的active残留为条件性非阻断边界，见咖啡交付说明。

Luna创作内的具体工具失败、视觉及互动问题将在原始产物独立验收后追加；以上不提前替其签收。
