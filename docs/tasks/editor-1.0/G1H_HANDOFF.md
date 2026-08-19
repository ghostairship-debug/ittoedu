# G1H · 命令层锁住 wrap / textAlign / lineSpacing 交付

## 1. 任务范围与改动

- **任务**：G1H · 命令层锁住 wrap（media / component）、textAlign / lineSpacing（paragraph），断言写在块上且不写进 runs。
- **允许修改文件**：
  - `tests/unit/flowEditorCommands.test.ts`
  - `docs/tasks/editor-1.0/G1H_HANDOFF.md`
- **未触碰**：任何 `src/**` 文件或 G3C 占用的测试文件。

## 2. 测试覆盖详情

在 `tests/unit/flowEditorCommands.test.ts` 中新增/验证：
1. `updates block textAlign and lineSpacing on paragraph without polluting runs`:
   - 使用 `updateFlowEditorBlock` 更新段落块的 `textAlign: 'center'` 与 `lineSpacing: 8`。
   - 断言块对象上存在 `textAlign: 'center'` 和 `lineSpacing: 8`。
   - 断言 `runs` 保持原样，且任何 run 对象及 `run.style` 均无 `textAlign` 或 `lineSpacing` 污染。
2. `updates wrap left on media block`:
   - 使用 `updateFlowEditorBlock` 更新现有媒体块的 `wrap: 'left'`。
   - 断言 `block.wrap === 'left'` 并通过 schema / 历史记录验证。
3. `inserts component block and updates wrap right on component block`:
   - 使用 `insertFlowEditorBlock` 插入合规组件块（含 `packageId: 'test.pkg'`, `version: '1.0.0'` 等）。
   - 使用 `updateFlowEditorBlock` 更新该组件块的 `wrap: 'right'`。
   - 断言 `block.wrap === 'right'` 并通过 schema / 历史记录验证。
4. 保留原有的 convert-quote、last-heading、split/format/merge、undo/redo 等全部测试。

## 3. 验证结果

```bash
npx vitest run tests/unit/flowEditorCommands.test.ts
```
- **Test Files**: 1 passed (1)
- **Tests**: 16 passed (16)
- `git diff --check` 无空白或格式问题。
