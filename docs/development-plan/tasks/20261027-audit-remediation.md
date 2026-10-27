# 审计整改、真实UI与两题三路线验收
- Status / Owner: active / ChatGPT Root
- Outcome / Evidence: 【2026-10-27收口核对：历史active待核，保留原owner/锁；旧登记不单独构成写入冲突，真实重叠仅暂停相关写域。】Owner 2026-10-27明确授权正式开发和新创作验收；接手HEAD be65efef，产品源码clean，根目录四份审计MD untracked。证据输出 output/audit-remediation-20261027/，历史基线不作为新验收。
- Write scope: B1观察由原生Agent observation_reliability负责 HtmlActionDesktopPort/captureFramePaint/HtmlActionService/TaskHtmlPreview/ViewObservationDesktopService及直接测试；B2读取由 reading_local_edit负责componentPlatform/coordinator及读取/分页直接测试；Root负责集成、UI真实操作、采用/布局后续明确边界、Skill/Agent定向提效、docs和output。共享Engine、模型预算及任务板由Root单writer，叶子新增范围先协调。
- Write locks: diagnostics, ai-session, published-interaction, main-preload
- Acceptance: 不重放已应用动作；读取分页和精确局改正确；保留人改/身份/History/保存/冷开/离线；实际UI证据；两个新题各A主Agent+MCP/B主Agent独立HTML/C产品内置AI，T1/T2/T3、真实视觉及编辑深度分别判断，125%为参考线，失败及辅助不洗绿；不新增未经确认UI模式，不commit/push/发布。
- Validation: 修改后最小直接行为→真实消费者→相关回归；复用未受影响旧证据；重要职责变更由非作者独审；不调用本机外部模型Agent。新测试和真实作品逐批记录，不跑无信息增益全矩阵。
