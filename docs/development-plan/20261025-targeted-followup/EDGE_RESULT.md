# 两项边缘问题后续处理（2026-10-25）

**后续诊断更正：** 新一轮[Python调查](../20261025-format-core-repair/PYTHON_INVESTIGATION.md)查明，本报告所引旧inline `watch:null`会在Vite配置合并时丢失，未证明实际关闭watcher，因此下文该对照不能用于排除监听压力。新对照记录真实NoopWatcher后约4.83秒完成Worker/Python42；正式CA246原文件仍未改未复跑。此处保留当时记录及原raw，不沿用已被纠正的推断。

本次仅处理 Owner“好修就修一下”授权下有明确依据的小修。Offscreen 的晚订阅测试已修正夹具时序，最终完整文件 4／4 通过，独立审查通过；Worker／Vite 尚无可证实的简单根因，保持未修改。没有改产品 UI、模式、操作路径、全局 Vite 配置或测试 timeout，也未 commit／push／发布。

## Offscreen：晚订阅者在真实 activity ready 后启动

原用例完整名称：`keeps native HTML and owned srcdoc state while publishing cooperative activity snapshots; uncooperative timers remain live`。

原失败不能追认成通过：起点 `output/test-baseline/2026-10-24T15-57-58-625Z/initial.json` 失败而 `retry-257.json` 通过，属于 flaky；终点 `output/test-baseline/2026-10-24T17-20-02-350Z/initial.json` 与 `retry-250.json` 均失败，属于新增 stable。原始报告及 `known-failures.json` 的原比较保留。

具体失败是原第 250 行 `paused.late` 为 undefined；前一行当前 getter 返回 inactive 及 readonly 已通过。生产 `authoredDocumentBootstrap.ts` 的 owned-document bridge 在收到首次 activity 前允许 getter 为 undefined，收到后返回活动副本。作者 HTML 的 40ms／45ms 一次读取与宿主 mount 后 70ms 睡眠没有建立“首次 activity 已到达，再开始晚订阅”的先后关系。原报告没有回调顺序 trace，不能断定当次是 timer 未执行还是过早读值。

按 Root 确认的测试目标，`tests/unit/offscreenSandbox20261013.test.ts` 改为：native HTML 和 owned srcdoc 均保留解析期的独立 `initialEvents` listener，先分别观察真实 inactive 快照及真实初始 inactive 事件，再启动各自作者提供的晚订阅函数。函数独立读取当前 getter，并注册后续真实 `__runtime.activity` listener；nested 再精确断言恢复 active 的后续事件。`initialEvents` 只记录真实事件，不由晚订阅函数手动填充，也不控制晚订阅的 timer。没有使用更长固定等待、mock activity 或产品替代实现。

原当前快照、只读 descriptor／副本不可反写、协作 timer 暂停及恢复、不协作 timer 持续运行、原生和 nested 输入值、两个 realm 的 boot 身份、原 iframe／src、未 abort、空 diagnostics 及资源清理断言均保留。此前 Source async-mount 的初始 activity event 精确断言未动；native 链另有自己的初始事件证据，没有以 Source 链替代。

首次完整文件 4／4 通过，原始报告 `output/test-runs/targeted-followup-20261025/offscreen-activity.json` 保留。独立 Reviewer 指出 native 父／owned 的解析期初始事件观测也必须独立保留，Root 确认后补上 `initialEvents`；这是实质相关修正，随后只验证同一完整文件一次：

```powershell
npx vitest run tests/unit/offscreenSandbox20261013.test.ts --maxWorkers=1 --reporter=json --outputFile=output/test-runs/targeted-followup-20261025/offscreen-activity-initial-events.json
```

最终实际 1 个文件、4／4 passed、0 skip；目标 native HTML case 1,081ms，Source cooperative case 1,191ms。`git diff --check` 通过。原独立 Reviewer `/root/baseline_review` 已核实际 diff、生产 owner 与新 raw，最终增量独审通过：解析期初始事件、晚订阅 getter 与后续事件独立，原状态与生命周期断言保留，是去除非合同时序假设的夹具修正。该次证据只对应本次夹具修正后的聚焦范围，不覆盖或重写原终点全量失败，没有重跑无关范围。

用户影响：本次修复的是测试对“晚启动订阅者”前置条件的建模，没有改变 HTML 产品运行语义。真实 HTML 若只使用固定延迟一次读取、且不接后续事件，首次活动未到时仍可能取得 undefined；本次不承诺对任意第三方脚本全局暂停。单一 activity owner 与现有协作机制保持原样。

## CA246 Worker／Vite：保持未解决，不硬改

用例：`tests/unit/auditAllExportsDevCompute.test.ts` — `CA246: the actual Vite module Worker runs local Python through the backend dev request policy`。原测试、正式请求策略、计算源码和 Vite 配置本次均未改，也没有重复运行同假设。

既有证据分开保留：候选工作树原聚焦通过（17,984ms，真实 Worker／Python 输出 42 和请求策略断言），根目录起点原 initial 与独立 `retry-129.json` 都 60s 超时并出现 fork 终止超时。因此不能继续统称“当前无法复现”，也不能把候选通过签成根目录已修。

此前 Root 两个单次 ignored 探针的阶段日志表明：原探针停止在页面 load／模块服务边界，尚未创建业务 Worker 或运行 Python；45s 看门狗实际约 50s 才调度。Vite 显式 8 个 HTML 输入排除了“默认扫描全部历史 HTML”解释。只把 `server.watch` 改成 null 的反事实仍失败，且迟滞也出现在 Chromium context／page 创建和本机响应传输。这个结果不支持把 watcher 禁用落实为正式修复，更不支持扩大策略或延长 timeout。

原始定位证据继续保留在：

- `output/test-baseline/2026-10-24T15-57-58-625Z/retry-129.json`／`.log`；
- `output/test-runs/regression-boundary-repair/ca246-diagnostic-vitest.json` 与 `ca246-diagnostic-1792861785807/`；
- `output/test-runs/regression-boundary-repair/ca246-diagnostic-nowatch-vitest.json` 与 `ca246-diagnostic-nowatch-1792862157105/`；
- 前轮逐阶段事实见 `docs/development-plan/20261024-regression-boundary-repair/REMAINING_RESULT.md`。

结论：根目录运行迟滞的唯一根因尚未闭合，没有低成本且有依据的小产品修复。本次按 Root 指令停止新探针。若之后另行授权继续调查，最小方向是针对已观测的本机浏览器／Node 调度迟滞和未完成的 Vite 请求形成新的可证伪假设，而非重复 watcher、默认 HTML 扫描或 Python 执行慢的解释。

用户影响边界：这是开发环境真实计算链的自动化未决项；现有证据不证明正式生产 Python 计算或统一选中 UI 出现同因故障，也不能据此签它们已无问题。
