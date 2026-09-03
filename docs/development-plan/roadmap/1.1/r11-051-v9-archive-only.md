# r11-051-v9-archive-only｜保存、打开与校验只支持 V9 archive

- Release / Dependencies: 1.1 / r11-050-v9-fixture-foundation
- Owner: App Save / Recovery（App Composition）；LEG-008 的台账 Owner 仍为 Tooling / Release，只有 r11-053 可写共享 inventory
- Write locks: `app-save-recovery`
- Inventory access: read
- Preservation: PM-02, PM-10–PM-15, PM-26

## Outcome / current evidence

产品与 headless tooling 只创建、打开和验证 Course Project V9 archive；V8 archive adapter/migrator/sample 退出所有正式路径，非 9 版本继续明确 `unsupported`，损坏包继续明确 `corrupted`。当前 `src/renderer/project/saveProject.ts` 仍从 `projectArchive.ts` 导入并重新导出 `createProjectArchive` / `createProjectArchiveAsync`，是 LEG-008 明确登记的产品源码 consumer；即使它当前只有测试 caller，也必须在本节点改成 V9 wrapper，不能等待 r11-052 删除测试后再处理。

## Read first

- `src/renderer/project/courseProjectArchive.ts`
- `src/renderer/project/courseProjectIo.ts`
- `src/renderer/project/openProject.ts`
- `src/renderer/project/saveProject.ts`
- `src/renderer/project/projectArchive.ts`
- `src/renderer/project/recoveryWriteCoordinator.ts`
- `scripts/validate-project.ts`
- `docs/development-plan/inventories/legacy-consumers.json#LEG-008`（只读）
- `docs/development-plan/roadmap/1.1/r11-052-supported-test-migration.md`

## Exact targets

| Exact target | Owner | Required result / deterministic replacement | Legacy action |
|---|---|---|---|
| `src/renderer/project/courseProjectArchive.ts#createCourseProjectArchive/createCourseProjectArchiveAsync/openCourseProjectArchive/openCourseProjectArchiveAsync`；`src/renderer/project/courseProjectIo.ts#openDefaultCourseProject/openDefaultCourseProjectAsync/saveCourseProjectDocument/saveCourseProjectDocumentAsync` | App Save / Recovery | V9 create/open/save bytes，保留 path/size/atomic checks、asset sidecar 与 component bytes | 不调用 V8 archive |
| `src/renderer/project/openProject.ts` 的全部 export | App Save / Recovery | wrapper 只从 `courseProjectIo.ts` / `courseProjectArchive.ts` 暴露 V9 open entry 与 `CourseProjectArchiveData`；不得继续 re-export `openProjectArchive`、`ProjectArchiveData` 或 V8 peek/migration helper | 删除对 `projectArchive.ts` 的 import/re-export；非 9 与损坏分类复用 V9 product entry |
| `src/renderer/project/saveProject.ts#SavedProjectArchive/saveProject/saveProjectAsync/serializeProjectArchive` | App Save / Recovery | `SavedProjectArchive.project` 改为 `CourseProjectDocument`，两个函数只接收 `CourseProjectArchiveData`，保持 clone 后更新 `updatedAt` 且不修改输入；同步/异步 bytes 分别调用 `createCourseProjectArchive` / `createCourseProjectArchiveAsync`；`serializeProjectArchive` 确定 alias 到 `createCourseProjectArchive`，不保留 V8 overload/union/fallback | 删除 `ProjectDocument`、`ProjectArchiveData`、`createProjectArchive` 与 `createProjectArchiveAsync` 的 legacy import/re-export |
| `src/renderer/project/recoveryWriteCoordinator.ts` 与 App/Main/Preload 的现行 archive byte transport | App Save / Recovery + Main/Preload | canonical committed V9 draft + sidecar/component bytes；single-flight、保存期间继续编辑仍 dirty、Recovery debounce/cancel/snapshot 不变；当前已是 opaque-byte transport 的入口只读核对，不为清零重写 IPC | 不接 V8 migrator，不改变 wire 或文件系统职责 |
| `scripts/validate-project.ts#validateCourseProjectArchiveBytes` | Tooling / Release | 与 GUI 使用同一 V9 parser/diagnostic；当前已走 `courseProjectArchive.ts` 时只读核对 | 非 9 fail-loud，不回接 V8 parser |
| `tests/unit/projectArchive.test.ts#updates updatedAt through the explicit save helper without mutating input`；`tests/unit/asyncArchive.test.ts#异步保存更新时间戳但不修改输入工程`；`tests/unit/courseProjectIo.test.ts` | App Save / Recovery（仅这两条 wrapper 断言） | 把同步/异步 wrapper 断言原样迁到 `courseProjectIo.test.ts` 的 V9 fixture，继续证明 input 未变、`updatedAt` 更新、sidecar/component bytes 重开一致；旧两个文件移除对 `saveProject.ts` 的 import 与对应 case | 这是 wrapper 变更必须同提交完成的最近层迁移；其余 V8 archive case 不在本节点处理 |
| `src/renderer/project/projectArchive.ts`、migration sample 与其余旧 archive test consumers | r11-052（测试迁移）→ r11-054（删除） | r11-052 按既定三分类迁移/删除剩余 tests；r11-053 完成唯一台账复核后才交 r11-054 删除旧模块 | 本任务不修改旧 archive 实现、其余旧测试或共享 inventory |

## Write scope

只允许修改 `src/renderer/project/courseProjectArchive.ts`、`src/renderer/project/courseProjectIo.ts`、`src/renderer/project/openProject.ts`、`src/renderer/project/saveProject.ts`、`src/renderer/project/recoveryWriteCoordinator.ts`、`scripts/validate-project.ts`，以及上述两条 wrapper case 所在的 `tests/unit/projectArchive.test.ts`、`tests/unit/asyncArchive.test.ts` 与其 V9 replacement `tests/unit/courseProjectIo.test.ts`。App/Main/Preload 当前 opaque-byte transport 只读核对；若发现必须修改其 wire、IPC 或文件落盘语义才能完成 wrapper 替换则停止并另行定界。禁止修改 `projectArchive.ts`、其他 tests、共享 inventory、Schema/fixture、添加 V8 导入/迁移 UI、改变 V9 zip 布局、丢弃 sidecar/component bytes 或破坏 single-flight/dirty/Recovery。

## Execution

1. 用 V9 fixture 记录 create/open/save/reopen/Save As/validate/corrupt/unsupported 的当前结果和 bytes ownership。
2. 先原子改写 `saveProject.ts`：类型、同步/异步 writer 与 `serializeProjectArchive` 全部落到 V9 API；不得先删 caller 后把 wrapper 留作孤立 LEG-008 consumer，也不得用双版本 overload 暂存。随后同提交迁移表中两条最近层 wrapper case 到 `courseProjectIo.test.ts`，保证 typecheck 和 touched suites 始终通过。
3. `openProject.ts` 只暴露 V9 product open；所有 product/headless entry 显式调用 V9 archive API。打开只完整解压一次，路径校验、大小限制和原子写盘保持。
4. Save 使用已提交 draft 的 canonical V9 document + asset/component bytes；保存期间继续编辑仍保持 dirty；同步和异步 wrapper 均证明不修改输入。
5. `schemaVersion !== 9` fail-loud 为 unsupported；不得调用 V8 migrator，也不得把损坏包误报 unsupported。
6. 对 `src/renderer/project/openProject.ts` 与 `saveProject.ts` 运行精确查询，确认不再 import/re-export `./projectArchive`，且不再出现 `ProjectDocument`、`ProjectArchiveData`、`createProjectArchive`、`openProjectArchive`。LEG-008 其余 test consumer 留给 r11-052；本节点 handoff 只报告实际消失的两个 adapter endpoint、V9 replacement 与查询结果，不修改共享 inventory。

## Stop conditions

- Save/Recovery/dirty/single-flight 或 sidecar round-trip 发生差异。
- 为保持旧 wrapper 测试通过而需要接受 `ProjectArchiveData`、调用 V8 writer 或保留双版本 overload。
- 两条 wrapper case 无法在 V9 fixture 上保持原断言，或需要顺带迁移 r11-052 所有旧 archive tests。
- 某正式 script/release consumer 仍依赖 V8 archive。
- 需要接受/迁移 V8 才能通过测试。

## Acceptance

- GUI 与 CLI 只打开/验证 V9；V8 明确 unsupported，corrupt 明确 corrupted。
- document、asset、component bytes 保存重开一致，Save As/Recovery 行为不变。
- `saveProject.ts` 的同步/异步 writer 和 `serializeProjectArchive` 只指向 V9 archive API，`openProject.ts` 只指向 V9 product open；两个 wrapper 对 `projectArchive.ts`、V8 document/archive 类型与函数均零引用。
- 两条 wrapper 断言已在 `courseProjectIo.test.ts` 用 V9 fixture 通过；`projectArchive.test.ts` / `asyncArchive.test.ts` 不再 import `saveProject.ts`，其余旧 archive case 的内容和 r11-052 三分类边界未被扩大或弱化。
- LEG-008/009 的 product/script/release consumer 在当前树为零，剩余纯测试 consumer 在 r11-052 处理；共享 inventory 留待 r11-053 原子复核。

## Focused validation

- `npx vitest run tests/unit/courseProjectIo.test.ts tests/unit/projectArchive.test.ts tests/unit/asyncArchive.test.ts`
- `npx vitest run tests/unit/courseProjectArchive.test.ts tests/unit/projectFormatIsolation.test.ts tests/unit/validateProject.test.ts tests/unit/recoveryWriteCoordinator.test.ts tests/integration/draftSaveTransaction.test.tsx`
- `npm run typecheck`

## Rollback / handoff

整体回滚 V9 wrapper 与两条最近层测试迁移；不得只恢复 V8 parser/writer 而连接到 product wrapper。交接按 LEG-008 列出 `openProject.ts` / `saveProject.ts` 已消失的旧 path#symbol、对应 V9 path#symbol、精确零查询，以及仍由 r11-052 持有的 test consumer；不得把 inventory 未经 r11-053 刷新误报为已更新。
