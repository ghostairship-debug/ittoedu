# M04 四表面真实界面检查

当前状态：**未运行 GUI**。`g20NamedSelection.test.ts` 的 2 项检查证明命名态冻结、只读授权和 materialized preview；不能替代本页的焦点、描边和真实入口检查。由集成 Owner 在同一构建产物上运行。

## 独立 fixture

在一次性工作空间内放入下列文件；不修改仓库原样本。可在 Playwright spec 的 Node 侧直接执行：

```ts
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { createNamedSelectionFixture } from '../helpers/g20NamedSelectionFixture'

mkdirSync(workspace, { recursive: true })
writeFileSync(join(workspace, 'selection.md'),
  '# 选区检查\n\n甲段：先预测😀，再观察。\n\n乙段：保持原样。\n')
for (const name of ['flow', 'spatial']) {
  copyFileSync(resolve('tests/fixtures/course-project-v9', `${name}.h5lesson`),
    join(workspace, `${name}.h5lesson`))
}
const fixture = createNamedSelectionFixture()
writeFileSync(join(workspace, 'named-selection.h5lesson'),
  new CourseV9Driver().serialize(fixture.model))
```

命名态样本包含 `scene-text`（基础正文、A 正文、B 正文分别不同且 A/B 横坐标不同）、`scene-other`、`global-text` 和 `surface-text`。状态条可选“命名态 A”“命名态 B”及基础场景；不要用更改磁盘 JSON 来模拟界面切态。

启动和本地模型配置复用 `g20ExecutionUI.spec.ts` 的独立 profile、本地 HTTP SSE server 与真实设置面板。不得把固定选区直接注入 controller，也不调用另一套 CLI。服务端只消费产品请求里真实签发的 handle；记录请求和正式工具返回，不自行伪造 committed。暂停工具参数的后半段直到测试主动释放，便于检查运行期间改选和晚到行为。以下发送均走本地 fixture route，无真实账号请求。

## 最少界面步骤

1. **Markdown 正文**：打开 `selection.md`，切“正文”，拖选“先预测😀”。点正文下方选区入口，在 `AI 指令` 输入“只把这一处改为先猜想😀”。点击输入框、模型菜单、附件按钮再关闭；检查正文独立高亮及草稿不丢。改选乙段时，原草稿仍指甲段；只有点“改为当前选择”才替换目标。用正文卡片“发送”发起本地请求；挂起期间改选乙段。释放后仅甲段被替换，标题、空行、乙段不变，正文和源文一致。一次撤销恢复原文。
2. **Flow 正文**：打开 `flow.h5lesson`，在可编辑正文的一个文字槽内选中一小段。用相同 `AI 指令` /“发送”入口替换；挂起时选择另一个块。正式请求冻结 `flow-range` 的 surfaceId/blockId/slot/from/to，目标不随改选改变。只改变选中文字；一次撤销恢复。再从主输入框引用同一选择并点“仅修改选区”，确认请求仍是同一类型的局部 handle。
3. **Slides 命名态**：打开 `named-selection.h5lesson`，选“命名态 A”，点击“命名态 A 正文”。点“AI 修改选中内容”，在 `选中对象的修改要求` 填“只将这个状态的正文改为 A 已修改”。点击“交给创作助手”；服务端挂起参数。切“命名态 B”，点“另一个对象”。A 的紫色固定描边/流式预览不得绘制在 B 的同 ID 对象上；B 的正文仍是“命名态 B 正文”。释放请求后，回 A 只看到“A 已修改”；B 与基础态分别保持原文。保存、关闭、重开后再检查三态；撤销证据在关闭前记录。
4. **Spatial 对象**：打开 `spatial.h5lesson`，选择一个有文字的 world 对象，使用“AI 修改选中内容”及同一输入/提交入口。主输入框、模型菜单和附件按钮之间转焦点时独立描边保持；挂起期间选另一对象，返回工具结果后仅原对象更新。其冻结 course-object **没有 stateId**。如样本首个对象非文字，使用现有文字对象或通过正式 UI 新增文字后再选择，不把非文字对象截图替代为正文。

每个表面第一次提交前可用 Escape 关闭局部浮层，再次打开检查引用/草稿仍在；“取消引用”才清理它。空选择不得出现可提交的整文档替代目标。失效选区应保留草稿并显示明确原因，不能自动扩权。

## 命名态补充检查与证据

- 在 A 同时选择 `scene-text` 与 `scene-other`：两项冻结目标均有 `stateId: 'named-a'`；切 B 后已发送任务仍指 A。
- 分别选择“全局基础对象”“表面基础对象”：即使界面处于 A/B，其目标都不携带 stateId。不要期待为这两类对象创建场景状态覆盖。
- 普通引用的 `selection` 是只读上下文。显式“仅修改选区”或局部提交才把对应精确目标放进 writable；不能因选中对象就扩大为 whole-document。
- 对象流式预览的初始文字、位置来自 A 的 materialized 内容（x=160），不能闪现基础正文（x=120）或 B（x=640）。
- 记录每次真实 main snapshot 的 documentId、epoch/revision、正式 mutation 返回、undoDepth 前后；截图记录 pin 转焦点、运行期间改选、完成后的结果。保存后重开另记保存结果，不把 dirty=false 单独当保存回执。
- 本地请求中只读 selection handle 与可写 target handle 分开。不要比较 opaque handle 字符串是否相同；检查其实际 inspect 内容、正式应用结果和越界拒绝。

建议逐表面独立案例，命名态作为 Slides 案例的核心断言。若任何入口不可用，记录具体失败并停止该案例，不能用 controller 直调替代 GUI 后记为通过。
