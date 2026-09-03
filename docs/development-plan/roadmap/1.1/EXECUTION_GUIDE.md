# 1.1 执行者指南

> 生效日期 2026-09-03，基于 HEAD `bb1f848`。本文是 1.1 剩余节点的通用执行规则、术语表、证据协议与交接模板；执行卡与各规格的"2026-09-03 执行版"段落引用本文。本文不保存任务状态，不替代 [工作协议](../../WORKING_PROTOCOL.md)。
>
> 优先级：执行卡 > 规格"2026-09-03 执行版" > 本文 > 规格其余段落。卡或规格与当前代码事实不符时，停止并按第 6 节交接；不得自行猜测，不得"顺手修正"。

## 1. 六条硬规则

1. **一卡一提交。** 一张卡结束时恰好一个 commit，提交信息用卡给出的那一行。不改卡外范围；不把两张卡合成一个提交。换行符归一化必须是独立的零语义提交，永不与逻辑改动混合。
2. **卡外不新增名字。** 只能创建卡"允许新建"清单里的文件、类型、函数与导出。需要卡里没有的新名字时停止交接，不得发明中间对象、Facade、helper、`*Ports` 汇总类型或 re-export。
3. **门测试只读。** 下列文件不得修改，除非卡明确写出允许修改的精确行号或断言：`tests/unit/architectureDependencyRatchet.test.ts`、`tests/unit/readModelBoundary.test.ts`、`tests/unit/legacyInventoryChecker.test.ts`、`tests/unit/preservationChecker.test.ts`、`tests/unit/developmentRoadmap.test.ts`。任何以"让门变绿"为目的的改动都是停止条件。
4. **先红后绿。** 卡要求新增的行为测试必须先写、先运行并在交接中粘贴失败输出，再改产品代码，再运行并粘贴通过输出。没有红的记录，绿不算证据；一开始就绿的测试说明缺陷不存在或测试没测到，同样停止交接。
5. **不改换行符。** 仓库文本文件当前为 CRLF。保存时保持原有换行；`git diff --stat` 中任何接近整文件行数的变化都必须在交接中解释。
6. **停止即报告。** 命中第 5 节任一停止条件时立即停止并交接，不尝试绕过，不降低断言，不加 `any`、非空断言、`passthrough`、`?? fallback` 或空 `catch {}`。

## 2. 术语表

每条给出仓库里的真实正例或反例。判断标准是结构事实，不是命名。

### 2.1 窄端口（typed port）

一个对象类型，每个成员是一个签名明确、单一职责的函数，只暴露调用方实际需要的能力；不包含 Store、`getState/setState`、完整 `EditorState`，也不用一个 `read()` 一次返回文档、会话、资源与投影的大包。

- 正例：`src/renderer/app/useCourseDelivery.ts` 的 `CourseDeliveryPorts`——`readCanonicalSnapshot`、`exportHtml`、`navigateFinding` 等，每个成员只做一件事。
- 反例：`src/renderer/authoring/featureAuthoringPorts.ts` 的 `FeatureAuthoringPorts`——`read()` 一次返回完整文档、sidecar、会话与投影，再附带 `persistProject`、`persistSlideCommand`、`persistSpatial`、`persistFlow` 等八个写入器。拿到它就等于拿到整个 Store。这叫**宽 Facade**，俗称换门牌。

### 2.2 只路由（root only routes）

根文件只做三件事：读取一个判别联合（route/context），选择恰好一个 owner，把窄 props 传给它。零业务逻辑、零 `useEditorStore.getState/setState`、零命令实现、零 effect。

- 正例：`src/renderer/ui/Workspace.tsx`（35 行）与 `src/renderer/ui/PropertiesTab.tsx`（7 行）。所有"根"文件最终都应长成这样。
- 判据命令：`grep -cE "useEditorStore\.(getState|setState)|produce\(|structuredClone\(" <根文件>` 期望为 0。

### 2.3 模块级全局绑定（service locator）

模块顶层的 `let x = null`，运行时由别处 `bind(x)` 赋值，再由 `resolve(ports ?? x)` 兜底读取。它绕过静态依赖图，是隐藏的全局变量。

- 反例：`src/renderer/authoring/v9TeacherControllerAuthoring.ts:105-120` 的 `boundTeacherControllerAuthoringPorts` / `bindTeacherControllerAuthoringPorts` / `resolveTeacherControllerAuthoringPorts`。
- 正确形态：依赖作为必填参数传入；没有 `?? bound` 兜底。
- 判据命令：`grep -nE "^let [A-Za-z]+.*=\s*null" <file>` 期望为 0（记忆化缓存 `let cached*` 属于另一类，卡会单独说明）。

### 2.4 代理导出（re-export）与包装函数

根文件用 `export { x } from '../owner'` 或 `function x(...) { return ownerX(...) }` 转发别处的实现。它让"根已收口"的检查失效。

- 反例：`src/renderer/store/editorStore.ts:1198-1202` 的 `export { editableComponentPackageId } from ...` 与 `export { layoutMediaBatchNodes, MAX_BATCH_CANVAS_ITEMS } from ...`。
- 正确形态：消费方直接从 owner import；根文件里没有 `export ... from`。
- 判据命令：`grep -nE "^export \{[^}]*\} from" <file>` 期望为 0。

### 2.5 镜像与双写

同一事实存两份并靠代码保持同步。canonical 在 owner 会话里，Store 根再存一份"方便订阅"，就是镜像；每次写都要写两处，就是双写。

- 反例：`EditorState.history: HistoryState`（`editorStore.ts:845`），只是各 Surface 会话历史长度的计数镜像，由 `kernel.writeHistoryMirror` 同步写入。
- 正确形态：删除镜像，读方改用从 owner 派生的 selector（如 `selectCanUndoActiveSurface`）。

### 2.6 stale 结果与 identity 核对

异步操作开始时捕获一个 identity（工程 ID、修订号、会话代次或当前位置），每次 `await` 之后、每次写入之前重新核对；不一致时零写入并给出可操作错误。

- 正例：`src/renderer/app/useMediaImport.ts` 的 `assertFreshIdentity(started, portsRef.current.captureIdentity(), '无法替换图片')` 在文件对话框返回后立刻核对。
- 常见缺口：对话框之后核对了，但解码、打包、字体准备这类第二个 `await` 之后没有再核对；或者 identity 少了一个维度（只比工程 ID，不比会话代次或当前位置）。

### 2.7 fail-loud

不受支持或损坏的输入必须抛出带用户可读文案的错误，不得静默降级。

- 正例：`src/player/index.ts` 的 `parsePublishedCourseV2Entry` 对旧 payload 抛 `PLAYER_V2_ENTRY_UNSUPPORTED_ERROR`。
- 反例形态：`legacyInput ?? defaultValue`、空 `catch {}`、`as any`、`.passthrough()`、把错误改成 `console.warn`。

### 2.8 同一提交删除旧实现

"迁移一个函数"的完整定义：新位置有它；旧位置没有它；所有调用方指向新位置；没有 `export ... from`、没有同名包装、没有"先双写后清理"的注释。三者缺一即未完成。

## 3. 红→绿证据协议

适用于卡里"必须新增的行为测试"。

1. 按卡给出的文件、`describe`/`it` 名称与 arrange/act/assert 写测试。测试名必须与卡一致，便于复查。
2. 运行 `npx vitest run <该文件>`，把失败输出前 20 行粘贴进交接。失败原因必须与卡描述的缺陷一致；否则停止。
3. 修改产品代码（只在卡的写入范围内）。
4. 再运行同一命令，粘贴 `Test Files` / `Tests` 两行。
5. 运行卡列出的其余 focused 检查，逐条粘贴。

结构门（第 1 节第 3 条列出的文件）不适用本协议：执行者不写、不改结构门；结构门由 Integrator 在复查时运行。

## 4. 结构事实的查法

卡里的"期望 0"都用这些命令核对，粘贴命令与输出，不写"已确认"。

| 事实 | 命令 |
|---|---|
| 符号是否仍在某文件 | `grep -nE "\bSYMBOL\b" <file>` |
| 谁还在 import 某文件 | `grep -rlE "from '(\.\./)+store/editorStore'" src tests` |
| raw Store 调用 | `grep -rnE "useEditorStore\.(getState|setState)" <files>` |
| 模块级可变绑定 | `grep -nE "^let [A-Za-z]+.*=\s*null" <file>` |
| 根文件的 re-export | `grep -nE "^export \{[^}]*\} from" <file>` |
| 某类型的 import 方 | `grep -rlE "\bTYPE_NAME\b" src tests --include="*.ts" --include="*.tsx"` |
| 换行符是否被改动 | `git diff --stat` 与 `git diff --check -- <files>` |

## 5. 停止条件清单

开工前和提交前各过一遍；任一为"是"即停止交接。

| 问题 | 怎么查 |
|---|---|
| 卡给出的 file:line 符号在当前 HEAD 不存在或已改名？ | `grep -nE "\bSYMBOL\b" <file>` 为 0 |
| 需要新建卡外的文件、类型、函数或导出？ | 对照卡的"允许新建" |
| 某个删除目标仍有卡外 consumer？ | 第 4 节 import 查法结果非 0 |
| 结构门测试变红且卡没有允许改它？ | `npx vitest run tests/unit/architectureDependencyRatchet.test.ts tests/unit/readModelBoundary.test.ts` |
| `npm run typecheck` 失败，且修法需要 `any`、`!`、`passthrough`、nullable fallback 或改弱类型？ | 读错误位置 |
| 卡要求的红测试一开始就是绿的？ | 第 3 节第 2 步 |
| 卡列出的任一 PM 行为测试变红？ | 卡的 Validation 命令 |
| 需要改变 V9/Published wire、导出结果、保存/恢复语义或删除任何入口？ | 对照卡的"禁止" |

## 6. 交接模板

执行者只交这一份，不写总结性形容词；每条都是命令和粘贴的输出。

```text
## 交接：<card-id>
- 提交：<hash>；`git log -1 --stat` 输出粘贴
- 结果：<一句话，可观察>
- 红→绿：<测试文件#it 名>；红输出（前 20 行）；绿输出（Test Files / Tests 两行）
- 验收逐条：<命令> → <期望> → <实际输出>
- 结构事实逐条：<grep 命令> → <期望> → <实际输出>
- 换行符：`git diff --check -- <touched files>` 输出（期望空）
- 未做 / 越界：<列出或"无">
- 停止条件命中：<列出或"无">
- 下一张卡：不自动开始；建议 <id>
```

## 7. Integrator 复查清单

复查者（Codex / Claude）按此判定，不重跑执行者的全部工作。

1. 交接里每条命令的输出是否与自己在该 commit 上重跑一致（抽查 2 条行为命令 + 全部结构事实）。
2. 红→绿证据是否存在，红的原因是否是卡描述的缺陷。
3. `git show --stat <hash>` 中每个文件是否在卡的写入范围内；是否出现卡外新名字（`git show <hash> | grep -E "^\+export"`）。
4. 结构门在该 commit 上是否仍绿：`npx vitest run tests/unit/architectureDependencyRatchet.test.ts tests/unit/readModelBoundary.test.ts`。
5. 三道基线门状态：`npm run check:development-roadmap`、`npm run check:preservation`、`npm run check:legacy-inventory`；与卡开始时对比只能持平或变好。
6. 通过后：删除卡、`npm run generate:task-board`、按规格执行版签发下一张卡。
