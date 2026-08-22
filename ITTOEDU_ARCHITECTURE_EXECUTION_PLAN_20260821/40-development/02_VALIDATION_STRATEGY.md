# 高效验证策略

正确性优先，但验证次数和范围应与变更风险匹配。

---

## 1. 四级验证

### V0：静态卫生

每个任务：

```bash
git diff --check
```

必要时：

- 目标文件 TypeScript 编译；
- JSON parse；
- 路径检查。

### V1：目标验证

每个任务只跑：

- 1–3 个最相关 Vitest；
- 或 1 个目标 E2E；
- 或索引生成器测试；
- 或目标构建。

### V2：阶段验证

每个阶段一次：

```text
typecheck
相关 Feature 单元/集成
少量核心 E2E
build:desktop
```

### V3：最终验证

P6 收口后一次：

```bash
npm run verify
```

若准备正式发布，再运行 `verify:release` 和人工验收。

---

## 2. 任务到验证映射

| 变更 | 最小验证 |
|---|---|
| 文档/semantic index | 路径检查 + repo:index:check |
| 索引生成器 | 索引单测 + 真实生成 |
| 纯 selector/command | 对应单元测试 |
| UI 组合不改数据 | 组件测试 + 必要截图/目标 E2E |
| Store transaction/history | command/history 单测 + save/reopen 目标 E2E |
| sidecar | asset/history 单测 + save/reopen |
| Surface 编辑 | 对应 Surface 单测 + 一条 E2E |
| Preview mount | lifecycle 单测 + try-run E2E |
| Export | 对应格式测试，不跑其他格式 |
| Schema/Contract | typecheck + contract + fixtures |
| 清理 | 引用搜索 + 原消费者目标测试 |

---

## 3. 基线完整验证

P0 只运行一次完整基线，记录：

- 通过项；
- 已知失败；
- 平台；
- SHA。

后续目标是“不新增失败”，而不是每张卡重新证明全部。

---

## 4. 阶段验证建议

### P0

- repo index tests；
- `repo:index:check`；
- 不重复桌面验证。

### P1

- typecheck；
- boundary report；
- 相关 unit。

### P2

- typecheck；
- Component/Diagnostics/UI tests；
- 一条 App smoke。

### P3

- typecheck；
- Core history/transaction；
- Slide/Flow/Spatial 各一条编辑；
- save/reopen；
- build desktop。

### P4

- 三模式；
- components；
- interactions/runtime；
- diagnostics；
-一条跨模式 E2E。

### P5

- 各 Surface 独立；
- Surface switching；
- save/reopen；
- try-run。

### P6

- `npm run verify`；
- 最终人工流程。

---

## 5. Flaky 处理

- 第一次失败先重跑目标测试一次，确认是否随机；
- 随机失败单独建问题；
- 不通过把 retries 提高来掩盖；
- 不因无关 flaky 阻塞所有局部工作，但阶段收口必须处理或明确隔离。

---

## 6. 何时必须扩大验证

满足任意一项：

- 修改 canonical document；
- 修改 history；
- 修改 persisted Schema；
- 修改 Published producer；
- 修改 save/open；
- 修改 cross-surface navigation；
- 修改 component/runtime package bytes；
- 删除旧写入路径。

扩大到相关生命线即可，不自动跑全部格式和全部 E2E。

---

## 7. 人工验证

只用于自动化难以判断的部分：

- 视觉；
- 拖拽手感；
- 模式易用性；
- Flow 排版；
- Spatial 自由逛；
- Component/Runtime 实际互动。

每个阶段只选择代表工程，不做全功能穷举。
