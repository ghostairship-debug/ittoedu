# G0A · 活动 surface 槽恢复 pointer-events: auto

> 状态：**可领取**  
> 症状：G0 试运行稿纸滚不动（槽位把指针吃掉）  
> 车道：G  
> 合同变化：无  
> 工人先读：[02_WORKER.md](02_WORKER.md)、[G0_FLOW_NEAR_WORD_PLAN.md](G0_FLOW_NEAR_WORD_PLAN.md)

## 一句话

`PublishedCourseSession.syncActiveSlot`：活动槽 `pointerEvents = 'auto'`，未活动槽保持 `'none'`。不要改宿主内部绘制。

## Git

1. 不要在 `/workspace` 或别人的 worktree 上改。只用本 worker 的 isolated worktree。
2. `git fetch origin cursor/flow-near-word-g-0ab9`
3. 从 **`origin/cursor/flow-near-word-g-0ab9`** 建 `cursor/g0a-slot-pointer-0ab9`
4. commit + push。**禁止开 PR。**
5. 写 `docs/tasks/editor-1.0/G0A_HANDOFF.md`

## 允许修改

```text
src/player/surfaces/publishedDynamicHosts.ts
tests/unit/publishedCourseNavigation.test.ts
docs/tasks/editor-1.0/G0A_HANDOFF.md
```

## 禁止

- `FlowSurfaceHost.ts`、`globals.css`、`editorStore.ts`、e2e、导出包其它文件
- 把未活动槽也改成 auto
- 改 `LayerFrame` / Schema
- 无 offset 整文件 Read `publishedDynamicHosts.ts`（先 rg `syncActiveSlot`）
- `npm test` / typecheck / e2e
- 同一路径 Read 第二次；全程最多 **8** 次 Read。信息够了立刻改代码，禁止再读确认

## 基线

`syncActiveSlot`（约 175–184）现在对**每一个**槽写 `slot.style.pointerEvents = 'none'`。活动槽可见但仍 none，稿纸 article 继承 none。`mount` 里新建槽默认 none 可以保留，`syncActiveSlot` 会立刻改活动槽。

## 逐步算法

把 `syncActiveSlot` 改成：

```ts
slot.style.pointerEvents = active ? 'auto' : 'none'
```

其它 visibility / zIndex / aria-hidden 逻辑不动。不要改 overflow。

## 测试

在 `tests/unit/publishedCourseNavigation.test.ts` 已有 `describe('published course Mixed navigation')` 末尾追加（不要删旧 it）：

```ts
it('enables pointer events only on the active published surface slot', async () => {
  const payload = buildPublishedCourseV2Payload({
    project: mixedProject(),
    assetFiles: {},
    components: {},
  })
  const session = createPublishedCourseSession(payload)
  sessions.push(session)
  const container = document.createElement('div')
  document.body.appendChild(container)
  await session.mount(container)
  const slots = [...container.querySelectorAll<HTMLElement>('[data-course-surface-slot]')]
  expect(slots.length).toBeGreaterThan(1)
  const activeId = session.navigator.current?.surfaceId
  for (const slot of slots) {
    const active = slot.dataset.courseSurfaceSlot === activeId
    expect(slot.style.pointerEvents).toBe(active ? 'auto' : 'none')
  }
  const flow = await session.goToLocation(payload.locations.find((l) => l.kind === 'flow-block')!.id)
  const after = [...container.querySelectorAll<HTMLElement>('[data-course-surface-slot]')]
  for (const slot of after) {
    const active = slot.dataset.courseSurfaceSlot === flow.surfaceId
    expect(slot.style.pointerEvents).toBe(active ? 'auto' : 'none')
  }
  container.remove()
})
```

若 `mixedProject()` / `goToLocation` 的 location kind 字段名与夹具不一致，以本文件已有用例为准改断言，但必须覆盖「活动 auto / 其它 none」以及切到 Flow 后仍成立。

## 最小验证

```bash
npx vitest run tests/unit/publishedCourseNavigation.test.ts
git diff --check
```

## Gate

- 活动槽 `pointer-events: auto`，未活动 `none`
- 未改 FlowSurfaceHost / CSS
- 未宣称 accepted

## 停手

必须改列表外文件才能让稿纸滚动 → 停，写 HANDOFF（滚动绘制是 G0B）。
