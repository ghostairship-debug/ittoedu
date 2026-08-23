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

## 7. 迁移顺序

1. 锁定现有 schema/host tests；
2. 建 Runtime/Interaction narrow facade；
3. 简洁模板改用同一 command；
4. Automation UI 改读 typed view model；
5. Developer draft 接入 transaction；
6. 迁移深层 Store consumers；
7. 最后拆大 UI 文件。

## 8. 必测行为

- stale Runtime draft；
- mount/destroy 幂等；
- 规则 undo/redo；
- 简洁模板转专业编辑；
- component/runtime gesture 优先级；
- export fallback；
- host error 不导致编辑器崩溃。
