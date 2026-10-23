# 咖啡 v06 · 软件修复线简要交接

本文件只交接本轮创作中已出现的具体问题。最终交付为主作品 r204、糖水 r34；完整验收见 `VERIFICATION.md`，下列历史阶段号只用于定位问题证据。本审查员仅检查下载到本地的源码与 Root 提供的现场事实；未改产品、未连接或关闭 Electron。

| 项目 | 归属与状态 | 对本轮作品的影响 |
| --- | --- | --- |
| Global Underlay 右／底至少 18px 留边 | 产品投影行为，源码已确认，未修 | 低优先显示限制，继续收口 |
| 实例 Source 更新后，旧共享 definition 报编译成品缺失 | 产品编译／导出路径问题；现象已确认，完整责任函数待软件线定位 | 已用正式共享 Source 更新＋清除实例 override 解决当前作品 |
| `img.onload` 导致重复 rAF | 作品 Runtime 缺陷，已修并定向验证 | 无需产品修复；已进入最终两份GLX并通过冷开／离线验收 |
| 保存稿出现非预期结构变化及进程关闭 | 仅保留现场事实，原因未确定 | 已从保留稿恢复到新副本／独立 profile |

## 1. 产品：Global Underlay 被套用控制器避让预算

**现象**：1440×1000 视口下背景为 1422×982；390×844 下为 372×826。前景仍覆盖完整宽度，右侧与底部可见浅色边。

**最小复现**：在 Flow 工程放置一个 `viewportPinned: true`、`style.width: '100%'`、足够高的全局 Underlay Source，使其 Canvas 铺满自身容器；正式播放或导出后比较背景容器与前景视口尺寸。

**已读源码责任链**：

- `playbackViewGeometry.ts`：`PLAYBACK_VIEW_CHROME_GUTTER = 18`；`playbackControllerInsets()` 无条件计算 `nativeScrollbar × PLAYBACK_VIEW_MAX_ZOOM + 18`。
- `playbackViewSession.ts`：`#deriveChrome()` 每次生成上述 `controllerInsets`。
- `teacherControllerViewportGeometry.ts`：`createTeacherControllerHudGeometry()` 从视口宽高扣除预算；`projectTeacherControllerInstances()` 将该视口应用到所有 pinned 全局实例，包括没有交互的背景。

所查实现没有作者侧关闭预算的现成配置；放大 frame 仍会被 clamp。本轮保留这一限制，没有改宿主、增加第二层背景或访问沙箱外 DOM。

**软件线建议**：区分需避让操作条的控件与应覆盖内容视口的非交互背景。修复后只需验证背景覆盖完整视口、前景控件仍可操作，以及已有导航避让没有回退。不要为单个作品硬编码 18px 补偿。

## 2. 产品：实例 Source 与原 definition 的导出编译集合不一致

**实际症状**：咖啡 r186/r187 与尚未装 U06 的 solute-study r21 均出现 `compiled-native-source-unavailable`。背景和导航可以运行，`pageerror` 为空，仍显示面向读者的红色缺失诊断；不能用没有页面异常来判为交付通过。

**现场证据**：Root 解包小工程导出 `course-data`，`nativeSources` 包含导航的 definition 编译结果和背景的 instance 编译结果。背景实例具有独立 Source override；其原共享 definition 仍声明 `implementation.kind: source`，但未有对应编译成品。

**供软件线缩减的复现序列**：创建共享 Source definition 并实例化 → 正式更新实例源码，形成独立 override → 保存并正式导出 → 检查未被该实例使用的原 definition 是否被作为缺失源码报告。现象与数据不一致已经确认；“编译收集按有效实现、校验却遍历全部定义”是强支持的根因方向，精确分支仍需结合编译器和诊断 producer 定位。

**本轮已实测的作者层解法**：背景只有一个实例，因此先以正式 `project.apply` 更新共享 definition 的最新 Source，再通过 `implementation.set(instance, null)` 清除旧实例 override，最后保存并正式导出。solute-study r23 与恢复后的咖啡 r190 已不再出现该诊断。未手改 GLX ZIP、编译产物或导出 HTML，也未绕过保存链。

**软件线建议**：使源码编译收集、有效实现解析和导出诊断使用相同的可达实现集合。保留编辑用 definition 可以合理，但未执行的旧定义不应制造读者端运行故障。不要直接压掉所有缺失诊断；真正有效实现缺编译成品仍必须报告。当前单实例作品的解法不能机械套用到共享同一定义的多实例工程。

## 3. 已解决的作品缺陷：图片 onload 与动画帧竞争

**原代码**：`symbols[].onload` 调用 `render(now, false)`。若已有动画帧排队，渲染结尾将 `raf` 清零，却没有取消原队列；随后快速跳章无法取消原句柄，可能暂时产生双循环。

**作品修正**：

```js
img.onload = () => {
  if (!disposed && !raf) render(performance.now(), false);
};
```

动画中由下一帧显示已加载图片；静止时补画一次。仅修改作品 `background-runtime.js`，无产品源码变更。

**定向验证**：真实 Runtime 源码配合可控帧调度宿主，重现“转场 → 图片加载 → 再次跳章”。修前待执行帧数 2，修后 1；到位、suspend、dispose 后均归零；重复 dispose 仅解绑一次，无残留监听。证据为 `evidence/lifecycle-probe.cjs`、`evidence/background-lifecycle-probe.json`。这项检查证明控制逻辑，不代替真实 GLX 的最终冷开和离线播放验收。

咖啡参数绘图本身不使用 `symbols` 图片；这项修正主要保护跨主题 SVG 配置案例。软件修复线无需再为它修改通用宿主。

## 4. 非预期结构变化：只记录，不归因

Root 比较保存文件发现：art-pass2 r188 有 183 个实例、一个原 Flow、完整导航 overlay；art-pass3 r200 有 186 个实例、额外 root，且 overlay 清空，随后该 Electron 被关闭。预期操作只包括共享 Source 更新与清除 override，没有新增 root、删除导航或关闭应用。

上述事实尚不能确定来自其他会话、人工操作或软件路径。本审查员此前 RDC 读取长期挂起，无成功执行、Electron 连接或修改。Root 已保留异常稿，从 r188 新命名副本恢复，并使用新独立 profile 继续；r190 的七章检查通过。

继续采用作品单 writer，保存时核对必要的对象／章节／导航不变量；若无更多证据，不将这次事件写成已确诊的并发软件缺陷，也不启动全面架构排查。

## 5. 参考索引复核

`REFERENCE_CASES.md` 已按最终计划目录复核相对路径：`background-runtime.js`、`programs/u03`、`programs/u05/u05-inline.html`、`programs/u06`、`native/OBJECT_INDEX.json`、`native/coffee-journey-v06.glx`、对应离线 HTML 及 `reuse/solute-study`。U05 原机制与三张帧素材正确回指 `../v05/`。

可复用说明保留了边界：背景不另建阅读状态；U03 需改写主题结构；U05 进度只表示视觉变化；U06 只适用于指定前提下的固定溶质稀释；普通图文保持原生身份。最终冷开、糖水正式 GLX 与离线复用已经完成，具体签证统一见 `VERIFICATION.md`。

## 6. 已解决的作品细节：浅色章节转场对比度

最终中间帧目视发现，U05深色进入U06时，部分深绿色说明在整段1350ms背景插值的前半段偏暗。作品Source现将浅色目的章节的base/tint单独以默认180ms稳定，物件仍保留1350ms平滑变化；每次打断从实际已绘制的颜色和位置继续。纸面时长钳制在有效范围内，不增加新的状态源或帧循环。

独立真实Source探针及最终GLX离线页面均通过。350ms桌面和手机采样中，背景纸面像素为[221,233,226]（含纹理），物件仍处于动画中。详见 `evidence/paper-transition-facts.json` 和 `evidence/final-timing-verification.json`。无需软件线再改通用宿主。
