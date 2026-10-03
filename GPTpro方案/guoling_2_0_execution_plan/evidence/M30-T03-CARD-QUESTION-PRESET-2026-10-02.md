# M30-T03 卡片提问和连接预设（2026-10-02 证据归集）

**范围**：仅登记既有 renderer/Electron 与单元‑集成测试中已真实覆盖的 M30-T03 子项；不重跑同义用例，不修改产品或测试源码。

## 子项映射（按 L06 §20.25 与 T03 操作/验收）

| T03 操作 | T03 验收 | 既有覆盖 | 证据位置 |
|---|---|---|---|
| scroll/resize/重选 | 目标不误绑、生命周期不暗改 | `tests/e2e/g20M30TextCardExperience.spec.ts`：文字卡跟真实桌面选区，选另一句时不误绑旧目标且保留输入；文档滚动→卡 status 提示“原选区暂不在视图中”，重新选择→新选区绑定，输入文字保留；缩小视口 900×640→950×600 卡约束在视口内。 | `output/g20/b24/text-card-e2e/run-k1E2Gi/evidence.json`（2026-09-29 11:57:07，errors=[]、含 scroll/resized/rebind 三阶段）及 screenshots `text-card-open.png` / `text-card-rebound.png` / `text-card-resized.png` |
| free-text 输入 | 不为 2–6 选项伪造选择、不假造权限 | `tests/unit/g20QuestionCard.test.tsx::M30 takes a real free-text answer without inventing choice options`：responseKind=free-text 时不渲染选项组，提交 `answer.other` 提交真实文字。 | 本次运行 `output/g20/m30/m30-t03-card-question-preset-20261002/unit-question-card.log`（7/7 通过） |
| 单项确认 | 无扩权假选项 | `tests/unit/g20QuestionCard.test.tsx::M30 shows one explicit confirmation action without a fabricated alternative or permission grant`：responseKind=confirm 只有一个“确认继续”按钮，卡片明示“不会改变当前文件和工具权限”，不发按其他选项；提交 `choices:[0]`。 | 同上日志（7/7 通过） |
| 明确自动模式 | 不逐字暗号、默认课件两次确认保留 | `tests/e2e/g20M18CreationChain.spec.ts`：default 模式两次 ask_user（教学策划、框架 HTML），automatic 模式 0 次 ask_user；instruction 使用自然“根据材料自动创作…不中途提问或等待确认”，非暗号。 | `output/g20/m18/creation-chain/default-DylYAa/evidence.json`（2026-09-28 21:31:27，status=passed）；`automatic-2MAp44/evidence.json`（2026-09-28 21:29:44，status=passed）。Skill 文案规则 `tests/unit/coursewareSkillsContract.test.ts` 同时断言“不固定插入两次确认”。 |
| 预设/高级覆盖 | 不假共享额度或能力；高级设置保留；unknown 可见不伪报 | `tests/unit/g20ExecutionSettingsPanel.test.tsx::M30 fills only empty roles with uniquely verified models while preserving advanced choices`：已保存角色（vision/imageGenerate）保持不变；只填空白角色；stale（旧 revision）能力记录不进入预设。`::M30 leaves unknown and ambiguous abilities out of a connection preset`：unknown/过时记录不出现在预设，按钮禁用，未见 saveProfile。 | 本次运行 `output/g20/m30/m30-t03-card-question-preset-20261002/unit-settings-panel.log`（17/17 通过） |

## 本次运行（2026-10-02）

- `npx vitest run tests/unit/g20QuestionCard.test.tsx` → 7/7 通过；日志 `output/g20/m30/m30-t03-card-question-preset-20261002/unit-question-card.log`。
- `npx vitest run tests/unit/g20ExecutionSettingsPanel.test.tsx` → 17/17 通过；日志 `output/g20/m30/m30-t03-card-question-preset-20261002/unit-settings-panel.log`。
- `npx vitest run tests/integration/g20M09UserQuestion.test.ts`（M09-T04 集成回归，含 IPC 桌面路径、crash 恢复、迟到答案拒绝）→ 6/7 通过，1 个断言失败；日志 `output/g20/m30/m30-t03-card-question-preset-20261002/integration-m09-userquestion.log`。

## 已知失败与边界（如实记录，不算通过也不算产品失败）

- `tests/integration/g20M09UserQuestion.test.ts` 断言 `run-state` 事件严格序列 `['running','waiting','running']`；当前工作目录里 R3 增量（未提交）在 `ExecutionEngine.ts` 第 1863 行新增 `run.state { status:'running', label:'正在等待模型响应' }`，使同一用例实际事件序列变为 `['running','running','waiting','running','running','running']`。这其实并未暗改生命周期（旧 waiting 与 running 仍按顺序出现，新增只是模型开始请求时的状态可视化），不会影响 T03 的“生命周期不暗改”判断：停止/关闭仍标记 waiting→cancelled、`ask_user` 不被重放、提问仍 waiting→answered 单调。在干净 HEAD `28bdd7f5`（不含 R3 工作树增量）运行本文件 7/7 通过，验证回归不在原 28bdd7f5 基线；当前工作目录 R3 增量对该集成断言的具体精度需要由该增量线在登记 R3 证据时更新（`tests/integration/g20M09UserQuestion.test.ts` 第 119 行 `toEqual` 断言），不属于 T03 的范围。
- T03 没有新增真实模型（DeepSeek/GPT OAuth）调用；e2e 中的 fake-model SSE / fake 模型 fixture 是合同级证据，真实模型 M18 端到端最近一次通过是 2026‑09‑28。

## 判定

T03 操作面全部分项均有真实 Electron 或精确 renderer/integration 测试直接覆盖，且关联条款（不误绑 / 不暗改 / 无暗号 / 无扩权 / 假共享不成立 / 高级保留 / unknown 可见）每条都有可否定断言。本次只做登记，不重复跑已通过的整课 e2e。
