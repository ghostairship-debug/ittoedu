# AGENTS.md 2026-10-02 新原则违反审计（5 份子智能体只读报告）

2026-10-02 Owner 修订 AGENTS.md 后，为对照新增的"模型与软件的职责分工"和
"一致性保护的现实边界"，派出 5 个只读子智能体审计现有源码，找出**软件
替代模型做判断、过程层双保险、过严权限拒绝** 等违反设计。

共发现 **46 条**，按严重度分为：

- **A 级**（完全阻止用户明确请求）——5 条，需要 Owner 拍板才能回退
- **B 级**（强制格式转换/失去保真）——3 条
- **C 级**（多余的格式/范围限制）——5 条
- **D 级**（轻微，冗余校验/性能问题）——多条

## 报告清单

| 报告 | 范围 | 主要发现数 |
|------|------|---|
| [file-services.md](file-services.md) | AgentFileService / 文件读写 | 11 条（P0–P10） |
| [gateway-permissions.md](gateway-permissions.md) | DocumentToolGateway / HostToolServices / 权限检查 | 8 条（P0–P8，最重） |
| [execution-engine.md](execution-engine.md) | src/main/workbench/execution/ | 14 条（5 个 P0、5 个 P2、4 个 P3) |
| [html-import-preview.md](html-import-preview.md) | htmlImport / htmlPreview / preview / DocumentToolGateway text.replace | 多条（A/B/C/D/E 分级） |
| [runtime-component.md](runtime-components.md) | htmlImport / ControlledBuildService / dynamicAdmission / RuntimeRegistry | 8 条 |

## 关键判断

1. **resume-observation-required 整套基础设施**（ToolReadCoverage 178 行 +
   assertObserved + requireReadObservation + ExecutionEngine.ts:538 挂钩）
   是"实现了一个被禁令点名的行为"——回退意味着删除一整套过程层死代码。

2. **HTML 导入的静态拒绝**（`import`/`fetch`/`iframe`/`modulepreload`/
   `onClick`/Google Fonts 等）违反 Owner 9-30 "导入优先让内容成功进入并使
   用"，且是 AI 生成课件最常见形态。

3. **完全访问档被错误降级**：`AgentFileText.commit()` 在 workspace 档下打
   开 workspace 外文件硬抛"需取得正式文档写授权"，直接违反 Owner 9-24 决
   定。

4. **file.write 强制 expectedVersion 必须来自 file.read**：CAS 在执行端已
   足够，这是过程层把"先 read"硬编码为接口前置条件。

其余细节请阅读各份报告的具体文件：行号与代码引用。
