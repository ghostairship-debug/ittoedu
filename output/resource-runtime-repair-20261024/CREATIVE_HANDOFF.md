# v08 创作线交接

2026-10-24。软件已提供可靠的批次几何与暂态运行基础；正式 v08 未修改。软件修复不会自动重写作品已有的视觉槽位、路线选择和艺术交接。

## 已独立确认属于作品的错误或选择

- `visual-slot.js` 与 `local-program-bridge.js` 将各自测量时的 viewport rect/reading 存进状态；`journey-runtime.js` 拼装不同到达时刻的最新槽位。历史 rect 和当前 reading 混用，足以导致错位，不能归因于同一次宿主布局事实。
- `.filter(Boolean).at(-1)` 让当前可用的最后路线决定运动段；锚点到达顺序、失效和反向滚动会改变所选路线。应由作品明确阶段、进入/退出与反向条件。
- 杯子的 entryX 取目的对象列、移动端将主体压到 14px、原生图与运动主体之间的艺术交接和图内锚点属于作品实现。宿主不会认识咖啡杯/果实或自动改变这些设计。
- 黑底去除、裁边、flood-fill 和同步像素扫描是作品程序。实测有成本，但本次原始 CPU/trace 不支持把全部启动/滚动耗时归因于它。优先在素材准备阶段生成可用透明运行图，或在作品内按相同输入复用结果。

## 修后软件的正确用法

1. 对正式 target 一次批量 `await context.scope.measure?.(references)`，同次计算仅采用同一批结果。不要用另一批 teacherController.read、历史 slot.state 或后来到达的 reading 补齐当前批次。
2. `viewportFrame` 在调用者视口 CSS 像素中。`flow.contentFrame` 是该真实 Flow scroll owner 的稳定内容基准；`contentToViewport` 将内容点投影到调用者视口。不同 containerId 的内容坐标不能直接相减。
3. 图片内部的 object-fit/crop/留白与局部程序材质主体仍由作品解释。宿主 target 的边框不是照片里果实的像素位置；作品应将其相对锚点先换到目标边框，再使用同批矩阵。
4. 已挂载离屏目标可测；未挂载或失效目标明确为 null，不可把历史样本冒充当前。布局/尺寸变化后重新批量测量，scope 退出后停止消费。接口不为未挂载内容虚构艺术锚点。
5. 路线计算和视觉写入保持一个作品 owner。沿现有调度合并重复测量，最多保留一个待回批次；按明确 route 身份更新。原生 opacity、局部 Canvas 与主体位置应由同一阶段计算，异步写入避免过期覆盖。
6. 现有 `target.motion.replace` 是暂态通道，可取消、按挂载释放，不写工程。使用 ctx.signal/task.cancel/cleanup；不要每帧 project.apply/object.update，不要把每个 slot 的 reading 当成全局通知总线。

最小通用示例（不包含咖啡路线）：

```js
const point = (m, x, y) => ({x:m[0]*x+m[2]*y+m[4], y:m[1]*x+m[3]*y+m[5]});
const batch = await context.scope.measure?.(refs);
if (!batch || !context.scope.isActive()) return;
const anchors = batch.targets.map((target, i) => {
  if (!target.viewportFrame || !target.flow) return null;
  const {u,v} = relativeAnchors[i]; // 作品定义的目标边框内相对点
  const frame = target.flow.contentFrame;
  const p = point(frame.transform, u*frame.width, v*frame.height);
  return {sampleTime:batch.sampleTime, containerId:target.flow.containerId,
    contentPoint:p, viewportPoint:point(target.flow.contentToViewport,p.x,p.y),
    scrollTop:target.flow.viewport.y};
});
```

## 仍需创作验收

七章导航和三个实验的基本运行不代表跨七章艺术路线连续性已经通过。创作线应另验桌面/移动、正反滚动、直接跳章节、锚点缺失时的明确降级、主体尺寸和入场列，以及原生与运动绘制的视觉交接。软件没有改动正式作品来制造路线通过结果。

详细定位与实际通用坐标样本见 geometry/REPORT.md、geometry/CREATIVE_HANDOFF.md；本轮固定环境的性能/输入结果见 PERFORMANCE.md。
