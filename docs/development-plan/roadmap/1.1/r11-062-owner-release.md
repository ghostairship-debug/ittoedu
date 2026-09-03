# r11-062-owner-release｜Owner 验收并决定是否发布 1.1

- Release / Dependencies: 1.1 / r11-061-no-regression-candidate
- Write locks: `none`
- Inventory access: read
- Preservation: PM-01–PM-28

## Outcome / current evidence

r11-061 自动化全部通过后，Owner 用固定课例检查真实结果并明确签署 `accepted`。本节点不由 Gemini 或 Codex 自动执行，不生成安装包，也不以 Hash 代替人工查看。

## Read first

- r11-061 的三条最终命令结果与 Codex diff 审查结论
- `docs/development-plan/roadmap/PRESERVATION_MATRIX.md`
- `docs/USER_GUIDE.md`
- `tests/fixtures/architecture-baseline/slide-heavy.h5lesson`
- `tests/fixtures/architecture-baseline/flow-heavy.h5lesson`
- `tests/fixtures/architecture-baseline/mixed-spatial.h5lesson`
- `examples/render-host-benchmark/render-host-benchmark-v9.h5lesson`
- `examples/render-host-benchmark/render-host-benchmark-v2.html`

## Execution

1. Slide：编辑、保存重开、Undo/Redo、试运行、整课播放与适用 PPTX/PDF/HTML。
2. Flow：正文编辑、保存重开、Undo/Redo、试运行、整课播放与 DOCX/PDF/HTML；不要求或放行 PPTX。
3. Spatial/Mixed：画布、镜头/路径、跨 Surface 历史、播放与适用 PPTX/PDF/HTML。
4. Runtime/Component：作者态、试运行、整课 Player 和离线 HTML 中真实可见、可互动。
5. 任一问题记录实际步骤并退回开发；全部可接受时才签署 `accepted` 并决定是否创建 `v1.1.0` 源码标签。

## Write scope

仅允许 Owner 写验收记录和经明确批准的版本/标签元数据。禁止为通过验收修改产品或测试、生成安装包或把 engineering candidate 自动写成 accepted。

## Acceptance

- Owner 看过上述真实结果并明确签署。
- Flow/DOCX 与 Slide/Spatial/PPTX 边界正确。
- 未签署时不 tag、不发布。

## Focused validation

- 人工按上述四组课例检查；不重复运行 r11-061 自动化。

## Rollback / handoff

验收失败不发布；交回首个可复现问题。
