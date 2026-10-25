# Python 开发测试载体修复结果（2026-10-25）

候选正式 CA246 原文件已单次 **1／1 passed、0 skip，12,599ms**；实际 resolved watch=null、`NoopWatcher`、getWatched={}。只修改该测试拥有的一次性 Vite 装配，不改生产 Python、全局 Vite／HMR、网络策略、原四个正确 expect 或 60s。

候选已由独立 Reviewer 审查通过并精确集成。Root 原环境使用原 Vitest 配置、不带候选 realpath setup，原完整文件单次 **1／1 passed、0 skip，4,815.6ms**，本轮开发载体修复已验证。没有 commit、push 或发布。

## 具体修复与边界

`tests/unit/auditAllExportsDevCompute.test.ts` 的 `createServer` 新增本地 `compute-test-no-file-watch` 插件，在 `configResolved` 将合并后的 `config.server.watch` 设置为 null。这避免 Vite 把 inline null 丢弃，让一次性 compute fixture 确实不启动无关文件变更监听。

该用例验收的是正式 dev `computeEntry`、真实 module Worker、完整本地 Python runtime 与请求策略；没有验收源码热更新。局部关闭其不使用的监听不改变受测计算功能，也不关闭工作台全局 HMR。

以下原行为和断言全部保持：真实 Python exitCode0／stdout42／stderr空／未取消，Vite env 依赖确实被请求，dev 无关路径拒绝，生产 origin 不获得 dev 路径；原 Backend、Worker、runtime 与 cancel／finally 资源清理代码不改。没有塞入控制页、CPU profile、延时重试或额外常设诊断门。

前轮因果依据和限制复用 Root 的 `docs/development-plan/20261025-format-core-repair/PYTHON_INVESTIGATION.md`：原配置控制页常量读取22.7s、工作 Node 局部迟滞；真正 noop 后约4.83s完成真实 Worker／Python。插件配置身份、缓存与时点变量明确，结论为强支持 watcher 相关启动压力，不追认为无条件唯一根因。

## 候选单次验证

工作树：`C:/Users/74755/.codex/worktrees/document-close-repair/果铃工作台`。保留 node_modules Junction 指向 `D:/果铃工作台/node_modules`，没有删除或重建它。

```powershell
npx vitest run tests/unit/auditAllExportsDevCompute.test.ts --config=output/test-runs/draft-compute-repair/compute/vitest-candidate.config.mts --maxWorkers=1 --reporter=json --outputFile=output/test-runs/draft-compute-repair/compute/candidate.json
```

- 原完整 fullName：`CA246: the actual Vite module Worker runs local Python through the backend dev request policy`，1 passed、0 failed、0 skip，12,599ms。
- raw：本工作树 `output/test-runs/draft-compute-repair/compute/candidate.json`。
- 最少生效事实：同目录 `candidate-watcher.json`，resolvedWatchIsNull=true、constructor=NoopWatcher、watched={}。
- `git diff --check` 通过。该次已结束并释放运行窗口，没有重复旧诊断、生产计算或全仓／类型检查。

Junction 环境适配仅在 ignored `vitest-candidate.config.mts`／`candidate.setup.ts`：精确 include 原完整文件、globalSetup=[]；setup 包裹实际 `Vite.createServer`，给该次 server.fs.allow 增加实际依赖 realpath，并写生效事实。它没有替换服务实现、Python、Worker、结果或策略，也没有把绝对路径写入正式 fixture／全局配置。此适配是候选证据边界，不能冒充 Root 无适配运行。

## Root 最小接收与验证

相对 **Root 当前基线**只允许接收两条路径，不整树复制：

1. `tests/unit/auditAllExportsDevCompute.test.ts`：仅上述 createServer 本地插件增量。
2. `docs/development-plan/20261025-draft-compute-repair/COMPUTE_RESULT.md`：本结果。

ignored config／setup／原始 JSON 是证据，不作为正式代码白名单集成。Root 已按上述两条白名单接收，没有把同步进候选的其他64个 dirty代码／测试文件再反向带回。

独立 Reviewer `/root/baseline_review` 已核实际 diff、原断言、正式 owner、候选 raw 与 ignored 适配边界，结论通过，未重跑。Root 接收后在原目录仅运行同一个正式文件，**不带候选 realpath setup**：

```powershell
npx vitest run tests/unit/auditAllExportsDevCompute.test.ts --maxWorkers=1 --reporter=json --outputFile=output/test-runs/draft-compute-repair/compute/root.json
```

Root 原环境本轮实际结果：1 passed、0 failed、0 skip，4,815.6051ms；raw 为 `output/test-runs/draft-compute-repair/compute/root.json`。原历史 baseline 与两轮诊断 raw 均保留，不回写成原先已过；原60s上限及原四个断言均未变。

用户影响：这是开发维护／验收可靠性修复，没有新增或改变产品 UI／模式／操作路径。正式生产不启 Vite，其已有真实统计、CSV／PNG 写盘及取消证据按原范围复用；使用频率仍无遥测，不据本测试推断普遍产品故障或无故障。
