# G0C · 试运行宿主与导出包不再把稿纸指针吃掉

> 状态：**可领取**  
> 症状：G0 `.flow-try-run-host` / 导出 CSS 与槽位一起把滚动打掉  
> 车道：G  
> 合同变化：无  
> 工人先读：[02_WORKER.md](02_WORKER.md)、[G0_FLOW_NEAR_WORD_PLAN.md](G0_FLOW_NEAR_WORD_PLAN.md)

## 一句话

Flow 试运行宿主可把指针交给内部稿纸；导出 `COURSE_PLAYER_CSS` 给 `.flow-runtime-article` 明确 auto + overflow auto。不要把 Spatial 画布改成可逛世界。

## Git

1. isolated worktree。
2. `git fetch origin cursor/flow-near-word-g-0ab9`
3. 建 `cursor/g0c-viewport-css-0ab9`
4. push。**禁止开 PR。**
5. 写 `docs/tasks/editor-1.0/G0C_HANDOFF.md`

## 允许修改

```text
src/renderer/styles/globals.css
src/renderer/export/course/buildCoursePackages.ts     仅 COURSE_PLAYER_CSS 字符串
tests/unit/flowTryRunCss.test.ts                      新建
docs/tasks/editor-1.0/G0C_HANDOFF.md
```

## 禁止

- `FlowSurfaceHost.ts`、`publishedDynamicHosts.ts`、`Workspace.tsx`
- 改 `.spatial-surface` / Spatial `touch-action: none` / 无限画布相机
- 把 `html,body` 改成页面级滚动冒充稿纸滚动
- 同一路径 Read 第二次；全程最多 **8** 次 Read
- `npm test` / typecheck / e2e

## 基线（≤2 Read）

1. `rg -n "flow-try-run-host|workspace--flow .canvas-viewport" src/renderer/styles/globals.css` → Read 那一小段（约 5782–5808）。
2. Read `src/renderer/export/course/buildCoursePackages.ts` 里 `COURSE_PLAYER_CSS`（约 62–87）。

## 逐步算法

### A. globals.css

`.flow-try-run-host` 增加 `pointer-events: auto;`。overflow 可以继续 hidden（孔仍是 720，滚动在 article）。

`.workspace--flow .canvas-viewport` **不要**改成 overflow auto 的整页逛世界。最多加 `pointer-events: auto;`。

### B. COURSE_PLAYER_CSS

在模板字符串里追加（保持现有规则，不要删 body overflow hidden 外壳）：

```css
.flow-runtime-article{pointer-events:auto;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.flow-runtime-overlay{pointer-events:none}
```

已有 `.flow-scoped-layer-mount{pointer-events:none}` 与子项 auto 保留。

## 测试

新建 `tests/unit/flowTryRunCss.test.ts`：

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { COURSE_PLAYER_CSS } from '@/renderer/export/course/buildCoursePackages'

describe('Flow try-run / export CSS paper hit', () => {
  it('lets the try-run host receive pointers without turning Spatial into a pan world', () => {
    const css = readFileSync('src/renderer/styles/globals.css', 'utf8')
    expect(css).toMatch(/\.flow-try-run-host\s*\{[^}]*pointer-events:\s*auto/)
    expect(css).toMatch(/\.spatial-surface\{[^}]*touch-action:none/)
  })
  it('documents runtime article scrolling in exported player CSS', () => {
    expect(COURSE_PLAYER_CSS).toMatch(/\.flow-runtime-article\{[^}]*pointer-events:auto/)
    expect(COURSE_PLAYER_CSS).toMatch(/\.flow-runtime-article\{[^}]*overflow:auto/)
  })
})
```

若 globals 里 `.spatial-surface` 不在同一文件（它在 COURSE_PLAYER_CSS），把 Spatial 断言改到 `COURSE_PLAYER_CSS` 上：`touch-action:none` 仍在。

## 最小验证

```bash
npx vitest run tests/unit/flowTryRunCss.test.ts
git diff --check
```
