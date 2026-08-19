# G2C-TC · 工具条单测补全 FlowTextEditSession 字段

> 状态：**第四波**（G2C 已合入；本卡只修 typecheck，不改工具条行为）  
> 症状：`npm run typecheck` 红在 `tests/unit/flowBlockContextToolbar.test.tsx`：`as FlowTextEditSession` 的 stub 缺 `source` / `surfaceId` / `parentId` / `field` / `pendingAction` / `revision`  
> 车道：G  
> 合同变化：无  
> 工人先读：[02_WORKER.md](02_WORKER.md)

## 一句话

把 G2C 工具条测试里的 `edit` stub 写成完整 `FlowTextEditSession`，去掉危险 `as` 断言。**不要改 `src/**`。** 五个行为用例必须继续过。

## Git

从 **当前** `origin/cursor/flow-near-word-g-0ab9` 建 `cursor/g2c-tc-fixtures-0ab9`。禁止开 PR。HANDOFF：`G2C_TC_HANDOFF.md`。

不要在 `/workspace`、`/tmp/g-coord`、`/tmp/g-lane-g` 上改。只用自己的 isolated worktree。

## 允许修改

```text
tests/unit/flowBlockContextToolbar.test.tsx
docs/tasks/editor-1.0/G2C_TC_HANDOFF.md
```

## 禁止

- 任何 `src/**`
- 删测试、弱化 `onCommand` 断言、改 `COMMON_FONT_FAMILIES` / KaiTi 期望
- 同一路径 Read 第二次；全程最多 **8** 次 Read；信息够了必须停工具直接改

## 逐步算法

1. 只 Read 一次 `src/renderer/authoring/flowTextEdit.ts` 里 `FlowTextEditSession`（约 55–71 行）确认必填字段。不要再读第二遍。
2. 只 Read 一次 `tests/unit/flowBlockContextToolbar.test.tsx`。
3. 把 `edit: { ... } as FlowTextEditSession` 改成合法对象，**去掉 `as FlowTextEditSession`**。最少补：

```ts
{
  kind: 'rich-text',
  source: 'paper',
  blockId: 'p-1',
  surfaceId: 'flow',
  parentId: null,
  field: 'text',
  composing: false,
  pendingAction: null,
  revision: 1,
  original: { text: 'Hello World', runs: [] },
  draft: { text: 'Hello World', runs: [] },
  range: { start: 0, end: 5 },
}
```

4. 删掉接口上不存在的 `cursor` 字段。
5. 不要改五个 `it(...)` 的断言语义。

## 最小验证

```bash
npx vitest run tests/unit/flowBlockContextToolbar.test.tsx
npm run typecheck
git diff --check
```

Vitest 必须仍 5/5。typecheck 必须 0 error（本卡修完后不应再报这个文件）。
