# 属性草稿切换与提交结果

2026-10-25。**确认并修复两种真实文字草稿丢失：B 未获原 owner 接纳却被控件标成完成；真实失焦后的 IME 最终中文在 A→B 切换中丢失。** 两个直接完整文件最终 44/44 通过、0 失败／跳过。候选经独审后已由Root精确集成，统一renderer／测试类型exit0，Root同一实际RightSidebar浏览器链1/1通过。叶子过程与候选事实按下文保留，Root最终证据见[综合结果](RESULT.md)和[实际入口结果](DRAFT_PATH_RESULT.md)。

旧三条失败不能直接解释为三个产品缺陷：数值／公式停放恢复本身已有正常实际浏览器证据；文字 IME 的旧断言虽过期，同链真实 blur-pending 路径确有产品丢稿。本次没有因“旧失败”豁免，也没有为旧测试恢复冻结面板。

## 1. 精确集成白名单（5 项）

候选起点已叠 Root 64 项当前代码／测试及前轮格式修复，不能按整个 worktree dirty 清单集成。本轮仅：

| 路径 | 本轮变化 |
|---|---|
| [PropertyControls.tsx](../../../src/renderer/ui/properties/PropertyControls.tsx) | 仅 TextContentTextarea 的提交结果／ACK：传本次 raw 给原 callback；同步 void 本地 stage 仍有效，Promise 等待真实 ACK；成功才更新 baseline／idle，失败保原 raw；pending 经原 property registry 暴露／恢复，pending 期间 Esc 不提前清输入；迟到恢复 ACK 不把新 composing／blur-pending 改成 idle。非 IME 换新控件、IME 保原 DOM 至 compositionend 的 Boundary 策略未改。 |
| [usePropertiesAuthoringBinding.tsx](../../../src/renderer/composition/properties/usePropertiesAuthoringBinding.tsx) | 仅现有 textCommands.commitEdit：核原 textSession、当前选择、已接纳的正文；返回原 writer／update 的 Promise，失败不提前清 textSession；ACK 时若有新输入或新 composition，保留同一 owner 继续处理。通用 run、beginEdit 的原 true=rebind 语义不改。 |
| [SlideNativePropertiesPanel.tsx](../../../src/renderer/ui/properties/SlideNativePropertiesPanel.tsx) | 仅内部 text commitEdit 合同增加可选 raw 与 Promise<void> 返回；控件与 UI 路径不改。 |
| [componentPlatformProperties.test.tsx](../../../tests/unit/componentPlatformProperties.test.tsx) | 三条原 fullName 保留，按真实 JSON 绑定、当前活 DOM 和停放／恢复／取消／持久保全等价核实；文字 IME 加真实 blur-pending。新增 B 拒接纳恢复＋一 History／GLX 冷开、实际 ACK 拒绝重试、同步 local stage、停放 ACK 恢复后新 IME 共 4 条。前轮格式测试增量已在起点，不重复归本轮。 |
| [DRAFT_RESULT.md](DRAFT_RESULT.md) | 本结果。 |

[候选相对 Root 起点精确 patch](../../../output/test-runs/draft-compute-repair/draft/candidate-vs-root-start.patch) 在 Root 集成本包前生成，仅前 4 个路径。`propertyDraftOwnership20261023.test.tsx` 未修改；其他产品、store／writer／保存服务、CA246、Vite、包配置均未写入。未 commit、push、发布或自行拷回 Root。

## 2. 真实 producer／consumer 与原三条裁定

实际属性路径为 RightSidebar 的 visited／hidden 常驻子树 → PropertiesTab → PropertiesPanelRouter → SlideNativePropertiesPanel → PropertyDraftBoundary／原字段。图层与属性访问后会保挂，不能以“换 tab 必卸载整面板”豁免原 owner。binding 由 usePropertiesAuthoringBinding 正式产生 JSON `[documentId,epoch,root,surface,state,selectedIds,global,fieldIdentity]`，下级字段追加其身份。

63992093 的 Boundary 及既有 `propertyDraftOwnership20261023` 明确：非 IME 换目标显示新控件，原 raw／已接纳 ACK 挂在同一 registry；只有真实 composing 持有旧 DOM 至 compositionend。卸载原件不在 flush 时重放，返回原目标由原 registry 恢复；文档 courseInputs 原恢复服务 durably 保全这些 raw。没有第二草稿 store、第二 Session／History 或保存路径。

| 原 fullName | 裁定、原失败原因 | 本次等价保护与实际事实 |
|---|---|---|
| retains a dirty draft when the captured target changes and refuses to retarget save | 夹具＋过期 DOM 期待。`first`／`second` 不是正式 JSON 绑定，卸载无法归属文档；同时要求非 IME 一直冻结旧 DOM，与当前策略冲突。不能为它改产品冻结整个面板。 | 使用正式 JSON 身份：B 是新活 DOM，A 原输入已断开；flush 不重放 A、不写 B，A raw 仍在正确 binding；回 A 原样恢复、在活 A 按 Esc 取消，两个 callback 均未误调。 |
| preserves a dirty formula source on target change and refuses to save it into the neighbor | 当前公式路径本身正常；旧例要求停放后 flush=false，并对已断开的 A input 按 Esc。实际停放不重放，flush=true 不表示 A raw 已应用／丢失。 | 核活 B 为原公式、A raw x+1 仍注册；原 courseInputs.persist 后 Main authoring draft 确有 x+1；Main instances／History 零变；回活 A 恢复 x+1 并取消到原 x，registry 清空、History 仍 0。Root 修前浏览器也验证 A 停放、B 应用、Main durable 保全及回 A 取消正常。 |
| keeps an IME property draft on target change and cancels its original canvas owner without writing the neighbor | 旧例直接 selectNode 无 blur，后续要求 detached input／flush=false 均不代表真实交互。**真实点击先 blur→blur-pending，同链确会丢 A 最终中文。** | 保 composing 时同一 A DOM；真实 blur 后换 B、compositionend 最终中文在原 binding 保留且 composing=false，B 显示其原文；回活 A 恢复最终中文、Esc 取消原 A canvas owner；Main 全实例与 History 零变。该保护修前实际浏览器失败，修后单测及Root同链实际浏览器均通过。 |

三条的 fullName 未改；没有 skip／exclude／timeout 变更，也没有仅把 false 改 true 后结束。

## 3. 两个真实缺陷、根因与修复

**B 未接纳却完成：** 实际 PropertiesTab 下 A 还有 slideContentEdit 时，选 B 后 beginSlideDataEdit(B) 返回 null。原 beginEdit 仅 report 后 void；字段仍收 B raw。commitEdit 发现 textSession 仍属 A 时通过 run 返回 void；Textarea 在 callback 前已经 idle／baseline=raw。因此 flush=true，但 Main B 未变、History=0，B raw 也从 registry 消失。修前真实红例及诊断分别为 [before.json](../../../output/test-runs/draft-compute-repair/draft/before.json)、[before-confirmed.json](../../../output/test-runs/draft-compute-repair/draft/before-confirmed.json)：每次仅运行该例，1 失败、26 跳过；诊断明确 completed=true、registry 只有 A raw、Main neighbor 仍“邻居”。跳过不算通过。

**IME 最终 raw 丢失：** Root 实际 RightSidebar＋图层 tab／Node 点击的修前浏览器记录：[root-before-tabs-corrected.json](../../../output/test-runs/draft-compute-repair/draft-browser/root-before-tabs-corrected.json)、[facts.json](../../../output/test-runs/draft-compute-repair/draft-browser/root-before/facts.json)。A composing 时 selected=B、同 A DOM、raw 为中文候选；compositionend(final) 之后 shared=null、registry=[]，回 A 只剩原正文，0 pageerrors。原因是旧 A updateDraft 的 liveTarget 拒绝最终 raw 后，blur-pending 仍经 void commitEdit 清 owner，Textarea 又先更新 baseline，导致保全判断认为无 dirty。

修复消除同一断点：commitEdit 不再经通用 run 吞掉结果；它在提交接纳时核当前捕获 owner／选择与本次 raw，并返回原提交 Promise。Textarea 等真实结果再更新 baseline，失败继续保 raw／原 owner。已接纳的 pending Promise 沿原 registry resume，不因面板换目标重复提交。**没有自动提交到 B、取消／释放 A、强制冻结 B、增加新模式／按钮／提示文案。** B 被原 A owner 拒绝时可保留 raw；回 A 完成或取消后，再回 B 恢复并提交，继续既有 owner 约束。

另一个直接消费者 CompositionProfessionalEditor 的 TextContentTextarea callback 是同步 void 本地 stage，外层“应用到作品”另等正式 onEdit。本次保持该语义，新增同步 stage 正例，未把所有 void 当失败或改变阶段路径。

## 4. 修后最小充分验证

[after-first.json](../../../output/test-runs/draft-compute-repair/draft/after-first.json) 的 43/43 证据保留。独审又指出一个同链真实相位问题：A pending→B→A 恢复 pending 后，若新 IME 仅开始而 raw 未变，旧 ACK 的 ready=true 可能把新 phase 置 idle。本次按最窄条件增加当前 composing／blur-pending 保护，并且 commitEdit 不在 session.composing 时退休 textSession，补单一反例。

最终 [after-final.json](../../../output/test-runs/draft-compute-repair/draft/after-final.json)：两个直接完整文件一次 **44 通过／0 失败／0 跳过**。componentPlatformProperties 30（原 26＋新 4），propertyDraftOwnership20261023 原 14。所有 raw／log 保留，未覆盖修前或首轮结果。

新增四条唯一可查 fullName：

- `does not acknowledge a new target text draft while the original captured text owner still blocks admission`：B 失败时 raw 在 B binding 且 Main／History 零写；A raw 也保留；回 A 恢复并取消，回 B 恢复 raw，真正完成后只有一条 History；原 A、邻结构保留，GLX 保存由独立新 Host 冷开完整模型一致。
- `waits for the actual property text ACK and retains raw and its original owner through rejection and retry`：真实 PropertiesTab／Store／Session；延迟原 kernel.write，flush 未提前结束、原 baseline／raw 保留；拒绝后 raw 与原 slide owner 还在、History=0；重试实际两次 proposal 仅一条成功 History，邻对象不变，完成后 raw 登记清空。
- `still accepts synchronous text staging before a composition editor applies its outer operation`：同步 void 本地 stage 成功，内容正确、一次 callback、无未应用草稿；没有改变外层应用到作品语义。

- `keeps a resumed text owner composing when its older parked ACK arrives before the next IME change`：原 pending 停放／恢复后新 IME 只起相位、raw 尚未变化，旧 ACK 到达仍保 composing、当前 flush=false、切 B 保同一 IME DOM；最终中文可回 A 恢复并取消，只调用 A 的原取消 callback。没有把旧 ACK 当新 IME 完成。

复用原 ownership 14 条完整文件检查：普通停放／返回、真实 IME DOM 交接、late ACK rejection、原未知结果的 cancel／retry、恢复输入、同值数值目标身份等。本次没有修改这些消费者断言。componentPlatform 原字号／颜色、公式 IME、保存、frame／History 等其余用例也一起通过。

实际命令（候选 cwd）：

```powershell
node node_modules/vitest/vitest.mjs run --config output/test-runs/draft-compute-repair/draft/focused.config.ts --testNamePattern='does not acknowledge a new target text draft' --reporter=json --outputFile=output/test-runs/draft-compute-repair/draft/before.json
node node_modules/vitest/vitest.mjs run --config output/test-runs/draft-compute-repair/draft/focused.config.ts --testNamePattern='does not acknowledge a new target text draft' --reporter=json --outputFile=output/test-runs/draft-compute-repair/draft/before-confirmed.json
node node_modules/vitest/vitest.mjs run --config output/test-runs/draft-compute-repair/draft/focused.config.ts --reporter=json --outputFile=output/test-runs/draft-compute-repair/draft/after-first.json
node node_modules/vitest/vitest.mjs run --config output/test-runs/draft-compute-repair/draft/focused.config.ts --reporter=json --outputFile=output/test-runs/draft-compute-repair/draft/after-final.json
```

修前 config 精确 include componentPlatformProperties；修后精确 include 上述两个文件；均 globalSetup=[]、maxWorkers=1。叶子未调用付费模型，未全仓／全矩阵／构建／单独 types。Root接收后已统一相关类型并完成同链实际浏览器复验，详见[综合结果](RESULT.md)；真实系统输入法键盘/OS IME未实测，当前IME证据是实际浏览器DOM composition协议与真实点击时序，不能冒称原生系统IME验收。
