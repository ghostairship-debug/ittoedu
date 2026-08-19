# G1H · 命令层锁住 wrap / textAlign / lineSpacing

> 状态：**与 G3C 并行**（只改 `flowEditorCommands` 单测）  
> 症状：G2A 字段能 `Object.assign` 到块上，但命令单测没锁；G3C 改绘制时容易把字段当死数据  
> 车道：G  
> 合同变化：无  
> 工人先读：[02_WORKER.md](02_WORKER.md)

## 一句话

用已有 `updateFlowEditorBlock` 写 `wrap`（media/component）、`textAlign`/`lineSpacing`（paragraph），断言写在块上、不写进 runs。

## Git

从 `origin/cursor/flow-near-word-g-0ab9` 建 `cursor/g1h-block-style-commands-0ab9`。禁止开 PR。

## 允许修改

```text
tests/unit/flowEditorCommands.test.ts
docs/tasks/editor-1.0/G1H_HANDOFF.md
```

## 禁止

- 改 `src/**`
- 改 G3C 占用的测试文件
- 同一路径 Read 第二次；全程最多 **8** 次 Read

## 逐步算法

在 `tests/unit/flowEditorCommands.test.ts` 用文件里现成的 Flow 夹具（Grep `createFlow` / `paragraph` / `media`）：

1. `updateFlowEditorBlock(..., { textAlign: 'center', lineSpacing: 8 })` 后该 paragraph 有这两个字段；`runs` 里没有 `textAlign`。
2. 对 media（或插入一个 media 块）`{ wrap: 'left' }` 后 `block.wrap === 'left'`。
3. 对 component 若夹具没有组件块：可 `insertFlowEditorBlock` 一个最小 component（packageId/version 用测试里已有或 `'test.pkg'`/`'1.0.0'`），再 patch wrap right。
4. 不要删现有 convert-quote / last-heading 测试。

## 最小验证

```bash
npx vitest run tests/unit/flowEditorCommands.test.ts
git diff --check
```
