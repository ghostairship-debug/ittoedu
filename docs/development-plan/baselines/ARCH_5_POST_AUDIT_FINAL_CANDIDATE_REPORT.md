# ARCH-5 审计后最终工程收口报告

> 日期：2026-08-25（Asia/Shanghai）
>
> 当前产品基线：`23f2d00`；最终测试修复：`0ed7f1f`；V4 候选声明：`64abba2`
>
> V4 生成物归档：`941e936`；最终收口任务：`arch-5-final-14-owner-waived-engineering-closure`
>
> 结论：`engineering candidate`；未打包、未做 packaged 性能/安全烟测，不是 `art candidate`、`accepted` 或发布就绪

## 1. 最终结论

根计划 13.1 的已激活稳定化工作已完成工程收口。审计 29 个编号项全部有终态处置：`27 implemented / 1 skip / 1 deferred`；额外的高级视频与高级图片合同议题也已有明确的 `deferred` 决定。所有实现、波次、决策、修复和生成物归档任务均有 Policy version 2 任务卡与提交证据，没有编号项或失败候选被静默删除。

最终产品/测试边界完成一次且仅一次完整 `npm run verify`：能力索引新鲜度、三组 TypeScript、完整 Vitest、全部构建和完整 Playwright 均通过。自动化与真实 Electron 纵切支持 `engineering candidate`；没有人工教师验收或美术验收，因此不升级到 `art candidate` 或 `accepted`。

用户在 V4 通过后明确要求“不必进行打包”。本次以 Owner scope waiver 取消 Windows package、同产物性能采样、packaged 安全/功能烟测与签名检查。这是未执行项，不是通过项；本报告不提供新包、不复用旧包冒充当前包，也不声明 release ready。

## 2. 可审计候选链

| 边界 | 结果 | 处置 |
|---|---|---|
| Candidate 07 `c2d6e1c` | 唯一 V4 在完整 Vitest 暴露 4 个失败：2 个旧 UI oracle、1 个 repo-index exact-case 预算、1 个作者路径测试结构/覆盖缺口 | `d1566af` 记录 `rolled-back`；没有重跑同一候选 |
| 修复 `f5ca015` / `9fa0181` / `a42ddba` / `0ed7f1f` | 安全默认切换、Spatial owner-aware 文案、repo-index 局部预算、作者路径四个真实错误分支全部聚焦通过；产品源码不变 | 四张任务卡分别关闭；作者路径独立 reviewer `APPROVE` |
| Candidate 12 `64abba2` | 唯一完整 V4 exit `0`；但 pretest 除预登记 HTML 外还刷新两份受跟踪示例归档 | 候选边界按规则 `rolled-back`，不把绿测掩盖为固定候选通过；V4 本身作为精确产品/测试证据保留 |
| Generated adoption `941e936` | 接纳 V4 在 E2E 前生成并验证的 3 份确切输出 | 独立 provenance reviewer `APPROVE`；没有重新生成、重跑广泛测试或修改产品 |
| Final closure | 复用未被产品/测试/fixture 变更失效的 V4 与波次证据，完成报告、任务板和 repo-index | Windows package 由用户明确取消；结论上限保持 `engineering candidate` |

## 3. 最终完整 V4

在 `64abba2` 上只执行一次：

```text
npm run verify
```

结果：exit code `0`，没有 broad retry。

| 门禁 | 结果 |
|---|---|
| AI capability freshness | pass；index `7,235 / 16,384` bytes；component catalog `available` |
| TypeScript | root/Renderer/Player/shared、Electron、E2E 三组配置全部 pass |
| 完整 Vitest | `254 / 254` files，`1,825 / 1,825` tests；`231.68s` |
| E2E pre-build | fresh Player、examples、lesson demo、render benchmark、component matrix、Renderer、Electron 全部完成 |
| 完整 Playwright | `33 / 33` tests；`33.6m` |
| 最终 Wave A / C / B 纵切 | `1/1` `2.0m`；`1/1` `1.0m`；`1/1` `5.1m` |

这 33 项真实 Electron 流程覆盖 Slide/Flow/Spatial/Mixed 的创建、文本、媒体、公式、组件、全局层、教师控制器、保存重开、恢复、Preview/Player、HTML/Web/PDF/PPTX、owner-aware 命令、跨 Surface history、Session camera 和五种渲染路径。它证明工程链和已登记行为，不证明实际课程的视觉质量或教师接受度。

## 4. 生成物与代表工程边界

V4 的 `pretest:e2e` 在 Playwright 前生成三份受跟踪输出。归档提交 `941e936` 固定这些已验证字节：

| 生成物 | 大小 | SHA256 | 语义证据 |
|---|---:|---|---|
| `examples/sample-project.h5lesson` | `18,612` | `F8EBAA940C1CBA9611DFB8C42A1C349DF7392E0C068668FB392B02822DC04FA3` | ZIP 仅 `project.json` 变化；完整 JSON diff 只有控制器 `defaultCollapsed: false → true`；生成器 reopen 校验通过 |
| `examples/photosynthesis-interactive-lesson.h5lesson` | `50,923` | `E57785860386B8FB37AB1C284AE592E13A07C04E1D3F77AF3533640663C25AAE` | 同上；reopened project 生成的离线 HTML 在 E2E test 26 通过 |
| `examples/render-host-benchmark/render-host-benchmark.html` | `3,863,027` | `7ABF5B8167B586A31A9C05D226A08955665A6F066D1A87BB91FF09B5EDAA4837` | HTML 外壳与 payload script 逐字节不变；唯一变化是与当前 Player bundle 逐字节对应的第二脚本；E2E test 30 通过 |

独立生成物 reviewer 核对了 ZIP 条目、完整 JSON、HTML 两个 script、生成顺序、hash 与 consumer，结论 `APPROVE`。`sample-project.h5lesson` 的证据是生成器 reopen，而非直接 E2E；该边界已明确记录。

三份架构代表夹具在 V4 后仍与冻结哈希一致：

| 代表工程 | 大小 | SHA256 |
|---|---:|---|
| `slide-heavy.h5lesson` | `7,050` | `101B8E8186E1FBADBF9F083E5D3273EEE9F1166FA3028478F290497537274A7B` |
| `flow-heavy.h5lesson` | `5,358` | `326B1C29D72358D01373AF26CBC6F97F396A34CE40E0E057079BBDCD76BEEEA0` |
| `mixed-spatial.h5lesson` | `6,583` | `939A0D5520FE21A6608A4CB11B8487F87D223A1DA15286965803EB4E2AAA66DF` |

## 5. 29/29 审计终态

详细逐项映射位于 `POST_AUDIT_STABILIZATION_CLOSURE_REPORT.md`，最终计数保持：

- 教师控制器与 Mixed：`7 / 7 implemented`；
- Flow：`11 implemented + 1 deferred`；
- Spatial：`6 / 6 implemented`；
- 跨模式：`3 implemented + 1 skip`；
- 合计：`27 implemented + 1 deferred + 1 skip = 29`。

`CROSS-03` 的 skip 原因仍是当前不存在真实 Flow/Spatial local Interaction carrier，不能为了填面板制造第二写路径；`FLOW-12` 的 deferred 原因和重开条件见下一节。`skip` / `deferred` 都是有证据的终态处置，但都不算功能实现。

最终测试修复还补上了 `CROSS-01` 的 evidence-freshness 漏洞：`59f5fdc` 已使 Spatial 插入提示 owner-aware，`9fa0181` 将旧 copy oracle 对齐到当前 global→world 指引，未回滚产品语义。

## 6. 三项明确延后事项

以下三项均因跨 strict V9、Published V2、Editor/Player/export 或浏览器/可访问性语义而属于中高风险，不是本轮遗漏。它们的决定卡 `Status: done` 只表示裁决完成，功能仍未实现。

### Flow 行内公式

- 当前替代：独立 `FlowFormulaBlock`；低复杂度内容使用纯文本或 Unicode，不宣称为可编辑、可访问的 inline formula。
- 重开条件：至少 `3` 份真实课件出现不可接受的“文字—公式—文字”正文需求，并有评审记录证明两种替代均失败。
- 重开后：先建 additive contract 与 consumer integration 卡，覆盖稳定 ID/AST/a11y、删除/复制粘贴/撤销、保存重开、Player、打印和 PPTX。

### Flow 高级视频

- 当前替代：保留已交付的预览、native controls、替换和基础布局；复杂编排先做现有 Runtime/Component 有界 spike。
- 重开条件：至少 `3` 份真实课件需要 poster、受控 start/end 或等价策略，且 Runtime/Component spike 失败。
- 重开前置：先形成 autoplay、键盘/读屏可访问性和不支持导出目标的降级政策，再建合同/consumer 卡。

### Flow 高级图片

- 当前替代：保留预览、替换、alt、题注和基础布局；使用预处理资产或显式 Slide 自由节点，不静默转换 Flow carrier。
- 重开条件：至少 `3` 份真实课件需要保存重开一致的 crop/focal，且预处理资产与 Slide 自由节点均不可接受。
- 重开前置：先定义 Editor/Player/导出一致性矩阵、素材替换语义和降级政策，再建合同/consumer 卡。

## 7. 用户取消打包后的证据边界

本轮未执行：

- `npx electron-builder --win portable dir --x64`；
- packaged executable 的启动时间、首个可编辑画布、峰值内存测量；
- portable/app.asar/source-map 大小与隐私检查；
- 当前候选的 Authenticode、production preload/protocol/security smoke；
- packaged 代表工程截图或人工发布验收。

因此状态分层为：

| 维度 | 最终状态 | 边界 |
|---|---|---|
| Audit mapping | `29/29 terminal` | 27 implemented、1 skip、1 deferred；另有高级视频/图片 deferred 决定 |
| Pipeline | `pass` | 唯一完整 V4 与最终 contracts/task-board/repo-index checks |
| Engineering | `engineering candidate` | 当前 V9 产品行为、保存/Player/export 与三波真实 Electron 证据成立 |
| Packaged artifact | `not evaluated by user direction` | 没有当前 Windows 包、性能、签名或 packaged smoke 证据 |
| Visible / art | `not claimed` | 自动化不能授予 art candidate |
| Accepted | `not claimed` | 尚无教师/产品 Owner 对真实课程的接受结论 |
| Release ready | `not claimed` | 打包、签名、性能与发布复核均不在本次完成证据中 |

## 8. 文档、任务板与索引收口

最终任务板为全终态：`115` 张卡中 `107 done / 4 wave-validated / 4 rolled-back / 0 claimed`。`wave-validated` 是已通过波次门的终态；`rolled-back` 保存失败候选的原始证据并均有后继修复或显式 Owner scope closure，不是无人处理的开放任务。

本报告、最终任务卡与任务板固定后，repo-index 由 canonical generator 统一刷新一次。最终精确状态通过：

```text
npm run check:contracts
npm run check:task-board
npm run repo:index:check
npm run repo:index:quality
git diff --check
```

该收口不重复 `npm run verify`，不重新生成已归档示例，不运行 Windows package，也不修改产品、测试、合同或用户数据。
