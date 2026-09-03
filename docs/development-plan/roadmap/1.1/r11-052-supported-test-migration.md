# r11-052-supported-test-migration｜测试只证明受支持 V9/V2 行为

- Release / Dependencies: 1.1 / r11-037-editor-store-owner-modularization
- Write locks: `generated-index`
- Inventory access: read
- Preservation: PM-02–PM-28

## 2026-09-03 Gemini 执行版

本节点按 [GEMINI_EXECUTION_PLAN.md](GEMINI_EXECUTION_PLAN.md) 的 052a–052d 四张卡执行。旧 A–E 波次作废：不在实施阶段运行 `test:product` 或 `check:preservation`，两者统一留给最终 r11-061。

## Outcome / current evidence

测试中仍有直接构造 V8 `PlayerScene`、旧渲染器模块、`ProjectDocument` / `SceneNode` / `ExportPayload` 成功路径。目标不是删除测试数量，而是让每个仍受支持行为由 V9/Published V2 最近层测试承接；V8 只保留明确 fail-loud 拒绝场景，并且拒绝测试不 import 旧类型。

## Four cards

1. **052a PlayerScene 测试**：处理 `playerSceneMotionLifecycle`、`playerSceneComponentEventBuffer`、`playerSceneAnimationMode`。
2. **052b 旧渲染器测试**：处理 ComponentEventMountBuffer、公式、NodeMotionDirector、旧视频绘制、教师控制器和 scene assets 七个测试文件。
3. **052c 旧 token 与拒绝夹具**：处理剩余旧类型和 `schemaVersion: 8` 命中；成功路径迁移，拒绝路径最小化。
4. **052d PM 证据链接**：只更新因前三卡移动的 preservation map/matrix 测试路径，不改 PM 行为。

每个旧 `it` 只能归入：

- 已有 V2 等价覆盖，删除重复旧成功用例；
- 仍受支持但缺 V2 覆盖，把同一断言迁到最近的 V2 host 测试；
- 明确 V8 拒绝，保留最小输入与 fail-loud 断言。

不能判断时停止，不自行删除。

## Write scope

只允许修改拆卡蓝图列出的旧测试、实际承接行为的 V2 测试，以及 052d 的两份 preservation 文档。禁止修改产品代码、Legacy scanner/inventory、排除项、timeout/retry 和结构门。

## Acceptance

- 所有保留的成功行为只走 V9/V2。
- 公式、视频、组件、动画、教师控制器、Runtime 与 Player 行为没有因删旧测试失去断言。
- V8 只剩明确拒绝场景，且不依赖旧类型导入。
- PM 测试路径指向真实存在的替代用例。
- 本节点不运行或宣称全量产品/保全通过。

## Focused validation

- 052a–052c：只运行当前卡实际修改的测试和承接它的 V2 测试。
- 052d：`npx vitest run tests/unit/preservationChecker.test.ts tests/unit/developmentRoadmap.test.ts`。
- 052d 另运行一次 `npm run check:development-roadmap`；不运行 `check:preservation`。

## Rollback / handoff

每卡单独回滚；交接只列“旧测试#it → 删除重复 / 迁移到 V2#it / 拒绝保留”，不记录 Hash 或全量日志。
