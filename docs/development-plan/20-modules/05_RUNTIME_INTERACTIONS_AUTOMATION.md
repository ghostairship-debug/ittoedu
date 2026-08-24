# Runtime、互动规则、动画模板与 Automation

## 1. 三类能力边界

### Runtime

承担整页/整世界连续机制、特效、复杂动态和引擎宿主。Canonical 是 V9 中的 `CourseRuntimeDefinition` / Runtime carrier。

### InteractionRule

承担声明式触发、条件和动作。简洁模板和专业规则编辑必须生成同一种标准规则。

### Automation UI

是作者界面，不是第三套业务模型。它组合 Interaction/Runtime commands，不直接操纵 Store 内部数组。

## 2. Runtime API 保留

- canvas-runtime API 2；
- surface-runtime API 3；
- renderMode、source、content、assets、bindings、static fallback；
- Slide/Flow/Spatial 各自允许的 Runtime carrier；
- Host 生命周期与安全边界。

本轮不统一或升级协议版本。

## 3. 代码草稿

Runtime 和规则代码使用：

```text
local draft
→ syntax / protocol / schema validation
→ stable target check
→ structured diff
→ feature command
→ Core transaction/history
```

草稿不能直接覆盖另一个 location 的 Runtime。

## 4. 简洁模板

简洁入口允许：

- 常用入场动画；
- 点击显示/隐藏；
- 点击跳转；
- 播放媒体；
- 少量标准参数。

模板输出标准 `InteractionRule`，不维护“简洁版规则”。专业模式打开后应能继续编辑同一规则。

## 5. 运行边界

- 作者数据只经 Published producer 进入 Runtime Host；
- Runtime 运行态事件和会话状态不写回 V9；
- Host mount/destroy 由 Preview/Player owner；
- Runtime Feature 负责定义、validation 和 authoring；
- Player Feature 负责实例生命周期。

## 6. 与 Component 的边界

- 局部独立复杂互动优先 Component；
- 整页动态优先 Runtime；
- Native + Interaction 处理稳定图文和常见声明式交互；
- 不因架构重构强制把现有组件改成 Runtime，或反之。

## 7. 已准入行为的候选迁移

Runtime、Interaction、模板、Automation UI、Developer draft 和深层 Store consumer 分别按可复现风险、真实 consumer 或明确替代目标准入，不使用固定迁移顺序：

1. 当前行为已有直接命令和清晰边界时，优先局部修复或保持现状；
2. 只有同卡首个真实 consumer 需要时才建立最窄 facade/view model，并立即接入该 consumer；
3. 简洁模板、Automation UI、Developer draft 和 Store consumer 只有各自证据成立时才迁移，互不作为占位前置；
4. 大 UI 文件只在具体行为迁移能降低可量化耦合时拆分，不以文件大小或阶段名称施工；
5. 未准入项允许零改动，已有兼容入口可在 Owner 和重访条件明确时 retained。

## 8. 按失效范围选择验证

下面是风险菜单，不是每张卡的固定测试清单。任务只选择被其改动直接影响、且现有证据已失效的最小子集：

- 改动异步 Runtime draft 时验证 stale target；
- 改动 Host 生命周期时验证 mount/destroy 幂等和错误隔离；
- 改动规则写入时验证 undo/redo；
- 改动模板/专业编辑共享规则时验证同一规则继续编辑；
- 改动输入占用时验证 component/runtime gesture 优先级；
- 改动 export fallback 时验证对应格式；
- 改动 Host error 边界时验证编辑器可恢复。

未命中的行为复用最近有效证据，不为完整覆盖菜单追加测试或人工流程。
