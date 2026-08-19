# G3D · 转浮层 / 插入浮层必须带 paperSpace=paper 的锁测

> 状态：**与 G3C 并行**（只改适配器测试，不抢稿纸文件）  
> 症状：G3B 在 `nativeMediaOverlay` / 组件转浮层写了 `paperSpace: 'paper'`，适配器单测还没锁住，回归时会 silently 掉  
> 车道：G  
> 合同变化：无  
> 工人先读：[02_WORKER.md](02_WORKER.md)

## 一句话

在现有 `flowSharedAuthoringAdapters.test.tsx` 里断言：媒体/组件 **转为浮层** 以及 **insert-overlay** 新建的内容层 `item.paperSpace === 'paper'`；教师控制器相关用例不得被改成 paper。

## Git

从 `origin/cursor/flow-near-word-g-0ab9` 建 `cursor/g3d-paperspace-tests-0ab9`。禁止开 PR。

## 允许修改

```text
tests/unit/flowSharedAuthoringAdapters.test.tsx
docs/tasks/editor-1.0/G3D_HANDOFF.md
```

## 禁止

- 改任何 `src/**`（行为已在 G3B；本卡只锁测试）
- 改 `flowSurfaceHost.test.ts` / `flowWorkspace.test.tsx` / `PropertiesTab.tsx`（G3C）
- 同一路径 Read 第二次；全程最多 **8** 次 Read

## 逐步算法

1. Grep 现有 `convertFlowMediaBlockToOverlay` 测试，在成功用例对 `createdLayerItemIds[0]` 用 `locateCourseLayer`（或测试里已有的 layer 查找）断言 `item.paperSpace === 'paper'`。
2. 若文件里已有 `convertFlowComponentBlockToOverlay` / `insertFlowSharedMedia`+`insert-overlay`，同样断言。没有 insert 用例就加一条最小 insert-overlay（复用文件里的 `createFlowProject` 夹具）。
3. 控制器用例：若有 teacher-controller 层，断言它 **没有** `paperSpace: 'paper'`（省略或 viewport）。
4. 不要弱化失败用例（段落不能转浮层、音频不能转浮层）。

## 最小验证

```bash
npx vitest run tests/unit/flowSharedAuthoringAdapters.test.tsx
git diff --check
```
