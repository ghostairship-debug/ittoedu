# r11-060-zero-gate｜最终运行一次 Legacy 零检查

- Release / Dependencies: 1.1 / r11-055-architecture-modularity-gate
- Write locks: `none`
- Inventory access: read
- Preservation: PM-01–PM-28

## Outcome / current evidence

在最终代码上只运行一次仓库现有 Legacy zero scanner，证明可执行范围不再包含 V8 作者工程、旧 Player/Export/archive 模块或独立旧 token。不生成候选 Hash、重复 JSON 报告或第二 scanner。

## Write scope

只读；禁止修改 scanner、inventory、排除项、产品或测试来消除命中。

## Execution

1. 运行 `npm run check:legacy-zero`。
2. 通过则结束；失败只记录首个真实 path#symbol，并返回 052、053 或 054 的最小责任卡。

## Acceptance

- 命令退出码为 0；没有通过新排除、改名或删功能实现零命中。

## Focused validation

- `npm run check:legacy-zero`

## Rollback / handoff

本门不写文件，无回滚。
