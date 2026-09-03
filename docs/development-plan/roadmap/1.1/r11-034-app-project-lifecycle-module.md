# r11-034-app-project-lifecycle-module｜App 打开、保存与 Recovery 形成生命周期模块

- Release / Dependencies: 1.1 / r11-025-editor-store-v9-only, r11-051-v9-archive-only
- Write locks: `app-save-recovery`, `workspace-properties`
- Inventory access: `read`
- Preservation: PM-01–PM-02, PM-06, PM-10–PM-13, PM-26

## 2026-09-03 执行版（基于 HEAD bb1f848）

通用规则、术语与交接模板见 [执行者指南](EXECUTION_GUIDE.md)。原规格的模块迁移步骤已经完成，不再执行；下面只保留剩余缺陷。

## Outcome / current evidence

已完成：`src/renderer/app/useCourseProjectLifecycle.ts`（578 行）持有新建/打开/最近工程、保存/另存、草稿 prepare/ack 与 Recovery；`src/renderer/App.tsx:149` 起只通过 `useCourseProjectLifecycle(ports, watch)` 接线。

剩余缺陷：`useCourseProjectLifecycle.ts:157–162` 的 `sameProjectIdentity` 只比较 `projectId`。因此在保存或恢复副本写入进行中，若用户重新打开**同一个**工程文件（同一 `projectId`），迟到的结果仍会写入新会话：`saveProject`（:384、:393）会用旧保存的路径去 `acknowledgeSaved` 新会话；恢复协调器的 `write()`（:191）会把旧会话内容写成恢复副本。`sessionGeneration` 不能作为区分信号：`createCourseAuthoringSession` 始终以代次 0 建会话（`src/renderer/authoring/courseAuthoringSession.ts:229`），代次只在资源撤销/重做时递增。

正确信号是本 hook 自己的 `loadEpochRef`（:221）：每次新建、打开、最近工程、恢复都经 `beginMutation()` 递增（:303、:315、:327、:341、:355、:421），但保存与恢复写入没有使用它。

## Read first

- `src/renderer/app/useCourseProjectLifecycle.ts`（全文）
- `src/renderer/App.tsx:149–200`（`useCourseProjectLifecycle` 的 ports 实现）
- `src/renderer/project/recoveryWriteCoordinator.ts`（只读 `schedule` 与 `write` 的签名）
- `tests/integration/draftSaveTransaction.test.tsx`（参考现有保存测试的 mock 写法）

## Exact targets

| 位置 | 改动 |
|---|---|
| `useCourseProjectLifecycle.ts:57–61` `CourseProjectLifecycleIdentity` | 新增 `readonly epoch: number` |
| `:157–162` `sameProjectIdentity` | 返回 `expected.projectId === current.projectId && expected.epoch === current.epoch` |
| hook 内（`:210` 起） | 新增局部函数 `const captureIdentity = (): CourseProjectLifecycleIdentity => ({ ...portsRef.current.captureIdentity(), epoch: loadEpochRef.current })`；hook 内所有 `portsRef.current.captureIdentity()` 调用（当前 :260、:283、:380、:384、:393、:519）改为调用它 |
| `:174–208` `createRecoveryWriteCoordinator(portsRef)` | 增加第二个参数 `captureIdentity: () => CourseProjectLifecycleIdentity`，`write()` 内（:191）用它比较；`:519` 处 `identity:` 用新函数捕获 |
| `CourseProjectLifecyclePorts.captureIdentity` 返回类型（:73） | 改为 `Omit<CourseProjectLifecycleIdentity, 'epoch'>`；`src/renderer/App.tsx:150–158` 的实现不需要改 |

允许新建：执行卡指定的 hook 级测试文件（放在 `tests/unit/` 下，文件名以执行卡为准）（红→绿测试）。不允许新建其他文件、类型、函数。

## Write scope

只允许修改 `src/renderer/app/useCourseProjectLifecycle.ts`，新建 执行卡指定的 hook 级测试文件（放在 `tests/unit/` 下，文件名以执行卡为准）；`src/renderer/App.tsx` 仅限类型收窄导致编译失败时的最小同步。禁止修改 Store、Main/Preload、archive、`recoveryWriteCoordinator.ts`、共享 inventory。

## Execution

1. 先写红测试 执行卡指定的 hook 级测试文件（放在 `tests/unit/` 下，文件名以执行卡为准），用 `@testing-library/react` 的 `renderHook` 与全部为 `vi.fn` 的假 ports：
   - `describe('useCourseProjectLifecycle stale results')`
   - `it('does not acknowledge a save whose session was replaced by reopening the same project')`。arrange：`captureIdentity` 恒返回 `{ projectId: 'p1', revision: 1, sessionGeneration: 0 }`；`prepareDraft` 返回 `{ ok: true, snapshot, token: {} }`，`snapshot.project` 用 `createBlankCourseProject()` 构造，`assetFiles` 与 `componentPackages` 为空对象；`saveProjectFile` 返回一个手动控制的 deferred Promise；`openRecentProjectFile` 返回 `{ bytes, path: 'same.h5lesson', confirmationId: 'c1' }`，`bytes` 由 `createCourseProjectArchive` 对同一个 blank project 生成；`confirmDiscardChanges` 返回 `'discard'`；`hasUnsavedChanges` 返回 `false`；`runBusy` 为 `(op) => op()`；其余 port 返回空值或已 resolve 的 Promise。act：调用 `saveProject()` 不 await；等待一个宏任务让保存进入 `saveProjectFile`；调用 `openRecentProject('same.h5lesson')` 并等待 `loadOpenedProject` 被调用一次；记录此时 `clearRecoveryProject` 的调用次数；resolve 保存的 deferred 为 `{ path: 'old.h5lesson' }`，await 保存的 Promise。assert：`acknowledgeSaved` 调用次数为 0；`clearRecoveryProject` 调用次数不再增加；`saveProject()` 返回 `false`。
   - `it('drops a recovery write whose session was replaced before the write ran')`。arrange：identity 同上；`desktopAvailable` 返回 `true`；`readRecoveryProject` 返回 `null`；`captureRecoverySnapshot` 返回 `{ ok: true, snapshot }`；`writeRecoveryProject` 为 `vi.fn`；`vi.useFakeTimers()`。act：以 `watch.dirty = true` 渲染并等待初始化 effect 完成，使恢复计划被 schedule；在 1800ms 到期前调用 `openRecentProject('same.h5lesson')` 并等待 `loadOpenedProject`；再 `await vi.advanceTimersByTimeAsync(2000)`。assert：`writeRecoveryProject` 调用次数为 0。
   运行 `npx vitest run <执行卡指定的测试文件>`，两条必须失败，失败点分别是 `acknowledgeSaved` 被调用 1 次与 `writeRecoveryProject` 被调用 1 次。粘贴输出。
2. 按 Exact targets 修改 hook。
3. 再运行第 1 步命令，两条通过；粘贴。
4. `npm run typecheck`。
5. 运行 Focused validation 第一条。
6. 结构事实：`grep -cE "expected\.projectId === current\.projectId && expected\.epoch === current\.epoch" src/renderer/app/useCourseProjectLifecycle.ts` 为 1；`grep -c "portsRef.current.captureIdentity()" src/renderer/app/useCourseProjectLifecycle.ts` 为 1（只剩新局部函数内的那一处）；`grep -cE "useEditorStore|from '\.\./store/" src/renderer/app/useCourseProjectLifecycle.ts` 为 0。

## Stop conditions

- 第 1 步的两条测试有任一在修改前就通过。
- 修复需要改 `recoveryWriteCoordinator.ts`、Main/Preload IPC 或 Store。
- 修复后 `draftSaveTransaction.test.tsx` 任一用例变红，且原因不是测试 mock 缺少 `epoch`。若是，只允许在该测试补字段，不改断言。

## Acceptance

- 两条新测试有完整的红→绿证据。
- `sameProjectIdentity` 比较 `projectId` 与 `epoch`；hook 内除新局部函数外没有直接调用 `portsRef.current.captureIdentity()`。
- PM-10、PM-11 的 focused 测试通过；`App.tsx` 与 hook 之间的 port 形状除 `epoch` 归 hook 外不变。

## Focused validation

- `npx vitest run tests/integration/draftSaveTransaction.test.tsx tests/unit/courseDraftPersistence.test.ts tests/unit/recoveryWriteCoordinator.test.ts tests/unit/courseProjectIo.test.ts tests/unit/readModelBoundary.test.ts`
- `npm run typecheck`

新增测试文件随本节点提交后，把它追加到上面第一条命令末尾。

## Rollback / handoff

单一提交，整体回滚。交接按指南第 6 节格式。
