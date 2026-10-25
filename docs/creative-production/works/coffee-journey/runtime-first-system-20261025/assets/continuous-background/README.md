# 连续阶段背景 · 事件绘制 v1.0.0

状态：已通过正式库提取、名称检索、跨工程插入、参数与源码依赖迁移及实际滑杆联动；跨主题完整作品验证另记。包ID：`library_e6a82cca-55c4-48ef-a4b5-d5a845a17afb`。

## 选择与入口

适合连续滚动叙事、数值联动和可逆颜色变化。硬切分镜、独立卡片、视频自动播放或纯静态作品无需采用。组件仅绘制一个实色背景，不含咖啡或雨城素材、章节、文案、版式与实验。源码3.5KB左右，零外部网络/图片依赖；已有场景只需颜色方法时可复用runtime-core.js，不必插入组件。

先 `asset.search {query:"连续阶段背景"}`；再用返回的packageId/version/sourceId读取详情。调用 `asset.use {packageId,path:"global/underlay.json"}`，path以目标工程实际project.list为准。未安装时用asset.import读取同目录.h5component归档。软件分配实例/定义、拷贝模块依赖并保存正式事务。后续用project.list返回的.data.json与.source路径修改，不抄示例对象ID。

## 输入、输出和修改边界

| 输入 | 语义 |
|---|---|
| mode | manual / reading / state |
| value | 手动数值；阅读或共享值缺失时的缺省值 |
| stateKey | 同一运行会话内共享状态名；空字符串不订阅 |
| field | 共享状态为对象时要读取的直接数值字段；标量留空 |
| stops | 至少两个、at严格递增的{at,color:'#RRGGBB'}；数量、区间、配色自由 |
| instance.stateBindings.progress | 可选正式声明绑定；优先于stateKey。只使用已声明courseState键，软件负责声明引用重绑 |

reading模式读取宿主当前Flow的reading.progress（0—1），不是固定七章，也不是自动测量任意章节边界。需要按章校准时自行以scope.measure同批几何得到进度关键点；runtime-core中的phaseFromStops支持任意数量，但不替模型判断叙事节奏。state模式可消费标量，或field指定的对象数值；只消费，不回写。颜色在相邻关键点间smoothstep插值，区间外取端点。作者可改源码、配色、来源和绘制方式。暂态数值不进入工程撤销或保存。

输出：一个不拦截输入的背景层；可读诊断dataset.runtimeAsset/value/paints，供验用。没有宣称可替代文本可读性或艺术判断。

## 生命周期

挂载读取当前状态并建立state/teacher订阅；事件只安排一个待绘RAF。没有活动事件时不循环。suspend取消待绘，resume按当前值补绘；update重绑输入订阅；dispose退订、取消RAF、移除自己创建的层。作用域cleanup保证销毁。

## 装配前提和真实失败

1. 大背景要有明确所有者。若页面本身是白色不透明背景，全局底层会被盖住；本轮实际复现，随后通过surface.configure的页面background {mode:'own',color:'transparent'}解决。不要用大渐变遮掩这类归属错误。
2. 原生正文颜色必须由作者按实际背景设计。包不自动改正文颜色、遮罩或布局，也不把所有页面强制透明。
3. 默认frame为1280×720且viewportPinned。采用时核对目标表面与全局容器实际尺寸，必要时用object.update调整。Flow手机布局仍须实际观察。
4. stateKey是有意的会话约定；普通JS字符串不会由软件自动重命名。需要跨工程托管引用时使用声明stateBindings；不把任意字符串当自动重绑保证。

## 证据与预览

正式采用源工程：../../runtime-toolkit-authoring.glx（r3）。跨工程证明：../../asset-reuse-proof.glx与.html（r5）；使用软件已有continuous-variable-v1配方，不另建滑杆库。

完整工具账本：仓库output/coffee-final-20261025/validation/mcp-receipts/0021—0048.json。0021提取；0025检索；0027插入；0044页面背景归属修正；0046实际输入；0047保存；0048官方离线导出。原始预览：同目录observations/0045-0.png、0046-0.png。

这是组件采用验证页，既有配方的默认排版不代表新作艺术方向。能运行和能插入不等于跨主题作品已经精美。
