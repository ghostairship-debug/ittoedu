# S13 受控构建工程证据审计

审计日期：2026-09-23（Asia/Shanghai）

## 结论边界

本轮证据支持将 `S13-T02`、`S13-T03`、`S13-T04` 的正式工程用例登记为 `passed`。其中 T03 由服务层非法候选检查和真实 Electron 隔离宿主交互共同闭合；单独一层都不足以替代整个场景。

这不等于 S13 整体通过。`S13-T01` 的实际 API 模型循环、`S13-T05` 的混合任务停止/部分完成 GUI、`S13-T06` 的外部包、离线导出与最终播放链仍缺正式证据，本文件不提升这些用例。成功 GUI 使用本地真实 HTTP 可控 Provider（`fixture-controlled-http` / `fixture-controlled-build`），不是 DeepSeek、TeamoRouter 或其他真实收费 Provider。

## 本轮实际执行

工作目录均为 `D:\果铃工作台`，直接调用 Vitest，没有触发 `npm pretest`、GUI、构建或收费模型。

1. `npx vitest run tests/integration/g20ControlledBuild.test.ts --reporter=verbose`
   - 结果：`1` 个测试文件通过，`3/3` 个测试通过；Vitest 报告测试耗时 `324ms`、总时长 `909ms`，开始时间 `05:21:09`。
   - 原始日志：`output/g20/b07/s13-controlled-build-engineering.log`
2. `npx vitest run tests/integration/g20HostToolServices.test.ts -t 'runs real scratch repair/read/compile/check/import|refuses changed build premises' --reporter=verbose`
   - 结果：`1` 个测试文件通过，精确选中的 `2/2` 个测试通过；同文件另 `4` 项未命中并显示为 skipped，不能计为通过。Vitest 报告选中测试耗时 `850ms`、总时长 `2.41s`，开始时间 `05:21:17`。
   - 原始日志：`output/g20/b07/s13-host-tools-engineering.log`

本轮合计实际选中并通过 `5` 个工程测试；没有新增或修改测试源码。

## S13-T02｜scratch 与正式文件权限

**判定：支持 `passed`。**

实际执行的 `tests/integration/g20ControlledBuild.test.ts:33` 在真实临时磁盘上完成以下步骤：

- 在受管 scratch 写入并读回 `source/main.js`，合法 scratch 读写与语法检查成功。
- 候选源码包含 `node:child_process` 与 `cmd.exe` 写外部 sentinel 的代码；服务只做语法解析，未执行候选，scratch 外的 sentinel 仍为 `original`。
- 对 `../sentinel.txt`、绝对外部路径、`x/../../sentinel.txt`、Windows 设备名 `CON`、尾点名称 `x.` 的写入均真实拒绝。
- 建立从 scratch 指向外部目录的 junction，再尝试写 `escape/escaped.txt`；调用被拒绝，外部文件实际不存在。
- 直接提交未支持的 `shell` 调用被拒绝，准入端口没有被调用。

这里的受保护目标使用 scratch 外的真实 sentinel/目录代表源工程或凭据目录；路径闭包对外部目录的业务名称无分支，因此验证的是同一实际边界。测试没有读取或写入真实用户凭据内容。

对应实现位置为 `src/main/workbench/build/ControlledBuildService.ts:46` 的受管目录 realpath 校验、`:213` 的闭包写入、`:227` 的只编译不执行候选源码，以及 `:295` 的受限调用分派。通过证据来自实际文件系统行为，代码位置只用于定位，不单独算通过。

## S13-T03｜资源闭包与当前状态保全

**判定：支持 `passed`。**

非法候选部分由本轮实际执行的 `tests/integration/g20ControlledBuild.test.ts:49` 证明：

- 带未授权精确 origin 的 V9 工程检查返回 `failed`；修复 origin 后同一工程变为 `ready`。
- 从真实 Component 资源闭包删除 `thumbnail.svg` 后，检查返回 `failed`，准入端口未被调用，因此没有导入制品。
- 已冻结的合格制品可由恢复后的服务读取；后续任何 source write 会使旧 artifact 失效，不能以旧检查结果导入新内容。

合法候选、真实交互和状态保全部分沿用已经执行的 Electron 证据：

- 命令：`node node_modules/@playwright/test/cli.js test tests/e2e/g20ControlledBuildUI.spec.ts --reporter=list,json --output=output/g20/b07/controlled-build-complete-playwright`。
- 结果：`1/1 passed`，用例耗时 `27.495s`，整次运行 `28.194s`；原始结果在 `output/g20/b07/controlled-build-complete.log` 与 `output/g20/b07/controlled-build-complete.json`。
- `output/g20/b05/controlled-build-ui/run-8oI6Vy/evidence.json` 记录本地 HTTP Provider 的 `12` 次请求、从 broken compile 到修复、真实 `courseware-editor://app/admission.html` 准入窗口、正式 `build.import`、零 renderer/server errors。
- 同一证据记录准入前运行态为 `location-scene-1`、`stateId: null`；root 已查看最终截图并确认导入后的真实按钮可点击显示答案，独立准入没有污染正在播放的课件状态。
- 导入产生单一 History：`undoDepth: 1`；Undo 恢复原源码/哈希，Redo 恢复候选源码/哈希，保存关闭重开后 `dirty: false` 且候选源码/哈希保持。

真实闭包和准入实现位置为 `src/main/workbench/build/ControlledBuildService.ts:248` 至 `:288`；这里的通过结论来自上述服务执行与 Electron 运行证据，不是静态代码推断。

## S13-T04｜导入目标变化与回执丢失

**判定：支持 `passed`。**

本轮实际执行的两个 Gateway 集成场景分别覆盖合同两半：

- `tests/integration/g20HostToolServices.test.ts:137`：构建 artifact 就绪后，人工先通过正式 `DocumentSession` 修改目标；随后 `build.import` 返回 `build-target-conflict`，人工标题保持不变。测试还证明局部授权不能创建整文档构建，停止后的 artifact 不能再导入。
- `tests/integration/g20HostToolServices.test.ts:98`：通过正式 Gateway 执行 create/read/broken compile/fix/check/import；导入后只有一个 Undo 条目，新增资源字节可随 V9 文档序列化/反序列化。随后恢复 Registry/Gateway，使用原 `operationId = import` 和原 payload 先查询再重发，二者都返回原 `applied` 回执；原会话与恢复会话的 `undoDepth` 都保持 `1`，没有重复对象、资源或 History。最终一次 Undo 同时恢复基线资源与 surfaces。

目标冻结检查位于 `src/core/tools/HostToolServices.ts:170` 至 `:179`，回执查询/幂等由 Gateway 和 DocumentSession 的持久操作记录完成。静态位置用于追踪；`2/2` 选中用例的实际运行日志才是本次通过依据。

## 保留的失败记录

失败没有从证据链中删除，且后续成功均由相关 fixture/断言修正触发：

- `output/g20/b05/controlled-build-ui/run-zjKUlT/failure.json`：首轮到达真实独立准入窗口，但 `build.check` 返回 `failed`，正式导入未发生。root 对同目录 `profile/workbench-v2/builds/957470bf-41a1-43dc-a9f8-1608c99209a0/state.bin` 的 Electron v8 反序列化诊断确认测试 fixture 的 PNG 无法完整解码；这不是放宽产品准入后通过，后续改用 Sharp 生成的有效 PNG。
- `output/g20/b07/controlled-build-host.json`：一次失败在等待完成文案时超时；该次底层已经观察到 12 个构建工具步骤、准入窗口与 import，仍按整个 UI 用例失败保留。
- `output/g20/b07/controlled-build-valid-image.json`：fixture 修复后的运行因测试要求隐藏的 `canvas-stage` 可见而失败。
- `output/g20/b07/controlled-build-playback-ready.json`：下一轮因测试读取错误的 `data-observation-ready` 属性失败；实际节点报告 `data-course-player-ready="true"`，仍不把该轮计为通过。
- 最终 `output/g20/b07/controlled-build-complete.json` 为独立的 `1/1 passed` 记录，并附 `controlled-build-evidence` JSON 与 `imported-component-click` 截图；它没有覆盖或改写上述失败记录。

## 未外推内容

- 没有执行真实收费模型，所以本地 HTTP fixture 不满足 `S13-T01` 的 real-model 前置。
- 本轮停止证据是服务/Gateway 层；没有据此声称 `S13-T05` 的混合直接编辑、构建预算、用户停止与部分完成 GUI 已通过。
- 没有验证外部工程包导入、正式包离线导出或最终导出物播放，因此 `S13-T06` 仍无通过依据。
