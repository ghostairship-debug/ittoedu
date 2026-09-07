# r18-099-dynamic-edit-verification：闭合Runtime替换连续修改与真实运行效果验证

- Release: 1.8
- Dependencies: `r18-096-capability-workspace`, `r18-097-semantic-edit-replacement`, `r18-100-task-feedback-loop`
- Optional: 否
- Write locks: `published-dynamic`, `published-slide`, `published-flow`, `published-spatial`, `store-kernel`, `contracts-schema`
- Gaps: G03, G08, G09

## 结果与现状

“改成不断翻滚的立方体”“慢一点”能完成真实Runtime替换和连续修订；临时宿主验证画面、动作和错误并把结果回送同一CLI任务。

已有动态准入/capture保证部分可运行边界，但自然语言替换缺create scope，静态封面或编译通过不能证明连续效果。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/renderer/authoring/tools/dynamicCandidateAdmission.ts](../../../../src/renderer/authoring/tools/dynamicCandidateAdmission.ts)
- [src/renderer/authoring/generation/admissionWorker.ts](../../../../src/renderer/authoring/generation/admissionWorker.ts)
- [src/shared/dynamicAdmissionContract.ts](../../../../src/shared/dynamicAdmissionContract.ts)
- [src/renderer/authoring/tools/runtimeInsertTool.ts](../../../../src/renderer/authoring/tools/runtimeInsertTool.ts)
- [src/renderer/authoring/tools/runtimeSourceTool.ts](../../../../src/renderer/authoring/tools/runtimeSourceTool.ts)
- [src/player/surfaces/publishedCapture.ts](../../../../src/player/surfaces/publishedCapture.ts)

## 允许写域与旧路径退出

既有动态准入/临时宿主、正式候选验证计划及其strict解析、Runtime/Component实际consumer与097替换接线；不扩任意脚本RPC或未批准宿主权限。

## 执行步骤

1. 将候选验证计划限定为已有位置/步骤、公开动作、时间点采样和公开状态断言；未知动作失败，验证运行在临时候选宿主。
2. Generated载体先走完整正式准入，再观察连续帧/生命周期/资源/错误；目标效果验证与安全/可执行准入分别出结果。
3. 将结果经100回传，让同一CLI根据具体诊断修订；通过后经097替换，默认保留选区几何和可迁移引用。
4. 再次“慢一点”读取当前包与运行结果，修改正确实例/共享范围；停止、卸载、切模式和重开不泄漏或错误重播。

## 验收与可信反例

- T05是实际随时间翻滚的立方体；T06减慢后连续机制保留，撤销/保存重开/Player/HTML均一致，修订有真实结果观察。
- 反例：只有封面、运行异常、素材缺失、无限循环/资源超限、错误共享包范围、取消/过期准入均不冒充成功，不改教师正在授课的live session。

## 停止条件

既有宿主公开动作不能证明目标时补受批准的窄验证动作合同；不得用任意eval/script、截图静态后备或关闭准入过门。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:product -- tests/unit/editorTransaction.test.ts tests/unit/publishedCapture.test.ts
npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts
```

真实临时与最终宿主按至少三个时间点/连续观察证明动画与变慢，再验证暂停/恢复/销毁；静态截图单张不够。

## 回退与交接

交付验证计划/结果样例、真实多帧与动作证据、100反馈输入；失败保留先前已提交阶段并明确部分完成。
