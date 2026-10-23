# 浅色阅读底快速到位 · 定向审查

仅审查作品 Source，不修改产品。读取 Root 最终本地 `background-runtime.js`，SHA-256：`14d4759019d97ef6e3884d2bfdf062372ebe3a7bbc01669d7c302b4a0339dfb4`。

## 结论

方案可以采用：物件沿原 1350ms 插值；目标基础色平均值大于 180 时，底色及 tint 按默认 180ms 独立 smoothstep 到位。`current.base/tint` 保存实际绘制值，快速打断时沿原 `read()` 复制为新的 `from`，没有产生独立状态 owner。深色目标仍沿原时长。

关键保护已在源码中：

```js
const paperDuration = lightTarget
  ? Math.max(1, Math.min(duration, Number(instance.data.paperDurationMs) || 180))
  : duration;
```

因此底色不会比物件总时长更长，原 `q === 1` 的 idle 停线仍充分。参数为 0 时沿现有 `|| 180` 规则使用默认值；负值钳制到 1ms。减少动态及 suspend 同时把两个进度置于目标。

## 对实际 Source 的定向行为探针

使用真实源码和可控帧调度，仅给测试 root 添加当前绘制值观察，不改变运行分支：

| 检查 | 结果 |
| --- | --- |
| U05 → U06，90ms | 底色为中间值 `[124,133,127.5]`，仅一个待执行 rAF |
| 180ms、350ms | 底色均已到 `[225,237,230]`；物件仍在插值，未提前跳到最终大小 |
| 350ms 打断到另一浅色章 | 新转场起点的底色与位置严格等于刚绘制的值 |
| 再反向跳到深色章 | 起点连续；675ms 仍是中间底色，保持原深色转场时长 |
| 1350ms 到位 | idle 为 true，rAF 数为 0 |
| 中途 suspend、重复 dispose | 直接显示目标，rAF 为 0；解绑一次，无残留监听 |
| 配置 3000ms | 被钳制到 1350ms，到位后没有未完成底色或残留帧 |
| 配置 0／负值、减少动态 | 按上述规则到位，减少动态无动画帧 |

证据：`paper-transition-probe.cjs`、`paper-transition-facts.json`。这些结果确认转场状态与生命周期，不替代 Root 对实际文字对比度、正式冷开和最终离线导出的验收。无需重复不受影响的 U03/U05/U06 全套交互。

## 正式装配后的补充签证

主创作Agent已将该Source正式提交为主r204、糖水r34，并完成两份新进程冷开和正式单HTML导出。桌面与手机350ms中间帧的纸面像素均为[221,233,226]（含纹理），物件仍处于动画中，文字可读。完整结果见 `../VERIFICATION.md` 与 `final-timing-verification.json`。
