# Engine 与互动遗留项收口结果

2026-10-24。基线 `699fc9e9`，启动时工作树干净。按 Owner 确认的 1→2→3→4 执行，仅处理下列四项；完成后 commit 并 push，不发布。本轮没有追加其他架构工作包。

| 顺序与范围 | 实际影响、根因及处理 |
|---|---|
| 1．暂停／重播 | 确认真实行为缺口：试运行→编辑暂停→回到初始画面→再次试运行，保留的原生进入规则没有再执行。`scene.replay` 在暂停时提前返回，订阅的 `initialized` 未失效；`resetSurfacePrograms` 只重建内容程序，原生互动订阅保留。现由原 `ComponentWorldInteractions` owner 在目标容器复位时清除初始化标志，复用 `initialize` 判断：暂停时不执行，恢复时进入一次；播放中复位立即进入。普通暂停恢复不重复，未命中容器及已退休订阅不触发。没有增加第二套暂停／导航系统。 |
| 2．教师按钮夹具 | 原测试误认为空白工程自带全局教师控制台，实际在进入渲染前访问了不存在的实例。夹具改用现有 `prepareCourseTeacherControllerEdits` 显式插入，再将按钮配置清空；验证没有配置按钮、没有上／下一步、保留折叠入口。没有恢复默认自动插入或回填用户删除的按钮，教师产品代码未改。 |
| 3．取消归属错误码 | 原权限拒绝正确，缺口是 `HostToolServices.jobCancel` 抛出普通 Error，被 Gateway 分类为 `invalid-operation`。在原拒绝处补 `job-not-authorized`，原判断、文案与调用顺序保留。接续任务仍只能读原成果；拒绝不调用取消服务，不重算、不改原作业；合法 owner 仍能取消自己的作业。 |
| 4．steer 终态预期 | 旧编排被用户调整取消，未开始的写入因 `steering` 跳过；新要求进入第二次真实模型请求，报告完成后任务为 `completed`。旧测试将整任务固定为 `partial` 已不符当前合同。仅维护断言，并补查第二轮收到用户要求、调整已应用、父编排仍 `programmatic-cancelled`、只有 read 实际执行，以及 revision／Undo 均为 0。普通协作消息仍允许原写入一次。Engine 产品算法与结束状态消费者未改。 |

暂停／复位的证据分层：

- before：新增实际 `ComponentNavigationOwner.replayCurrentSurface`＋`ComponentPlatformRuntime.resetSurfacePrograms` 回归，保持原产品源码时复现恢复后进入次数仍为 1、预期为 2；原始 `replay-before.json` 为 1 条真实失败。
- after：原订阅用例继续覆盖暂停挂载、暂停换页、普通恢复、不相关容器复位、播放中复位及退订；新增 World 用例覆盖保留订阅的暂停复位与销毁后不触发。原“暂停时立即进入”的断言改为暂停仍 3 次、恢复后 4 次，未删去恢复后的进入要求。
- 真实浏览器：`agent-browser` 操作现有 Main DocumentHost→Store／Bridge→SlideWorkspaceConnector→CourseV10RuntimeView 的“试运行／编辑／回到初始画面”按钮。计数为初始 0→首次试运行 1→普通暂停恢复 1→暂停复位仍 1→再次试运行 2；无报告错误，正式文档 revision 始终为 1。计量只包装 `world.setState` 统计原动作，保留绑定后调用原方法。临时桥接仅连接本地 Main，未替换按钮、导航或 Runtime 决策。

最小充分验证，原始 JSON／日志保存在本机 `output/engine-interaction-closeout-20261024/`：

| 检查 | 结果及证明范围 |
|---|---|
| `componentInteractionExperience.test.ts` 完整文件 | 7／7；包括新增的真实 Navigation／World 回归及原有互动体验检查。 |
| `g20ExecutionEngine.test.ts` 完整文件 | 57／57；两条原遗留断言收口，其他 55 条保留。 |
| `ni02RecoveredJobArtifacts.test.ts -t 'reads original ready computation'` | 1／1；真实持久计算成果的冷服务接续、保存、只读接续拒绝取消、零取消及原作业不变。其余 6 条未选中，不计通过。 |
| `g20ServiceToolDiscovery.test.ts -t 'keeps cancellation scoped'` | 1／1；实际 Gateway 保留 owner 合法取消与非 owner 拒绝，原只读权限不变。其余 5 条未选中，不计通过。 |
| `npm run typecheck` | 主配置、Electron、e2e 原三段全部通过，没有缩减入口或检查。 |
| 真实 Chromium 按钮路径 | 上述暂停／复位计数通过；`browser-after.json` 记录最终状态。 |

共 66 条实际选中的行为检查通过；聚焦 replay-after 的 2 条是完整互动文件的子集，不重复累加。没有通过 skip、零匹配或延长超时消除失败。最初浏览器观测包装未绑定 `this` 的试跑产生过错误，修正计量后重走同一路径；该次试跑不作为产品缺陷或有效验收。浏览器证据不扩称完整 Electron 壳层、所有作品／Surface、Published 或发布验收。

集中独审：未参与实现的 architecture_review 已只读核对实际 diff、直接消费者、before 反例、原始结果及导航记录，结论通过，无阻断项或必要证据缺口。确认暂停复位仍由原订阅 owner 处理、教师空按钮配置不回填、取消拒绝不下发且合法 owner 可取消、steer 两层终态与零写入保留；现有 66 条行为检查、三段类型及真实浏览器证据充分，无需扩测。Reviewer 未修改候选、未重跑有效检查。

收口：本轮两条 Engine 合同断言和两条互动遗留失败已处理，选中检查没有剩余失败。原架构批次的其他暂缓范围和重启条件继续沿[原方案 §15](../../../output/architecture-audit-20261024/IMPLEMENTATION_PLAN.md#architecture-batch-closeout)，本轮不自动重启。前轮结果的失败数量保留历史事实，当前入口改指本记录。

Git：Owner 已授权提交并推送本轮明确文件；启动时没有其他未提交成果需要合并。提交范围为两个产品 owner、三个测试文件、本记录与 README／CURRENT_STATUS 导航，共 8 文件；本机诊断输出不入提交。最终提交号及远端同步事实以 Git 日志与交付消息为准。不调用付费模型，不打 Portable、发布或部署。
