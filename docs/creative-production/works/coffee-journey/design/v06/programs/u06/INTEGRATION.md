# U06 科学图解 · 正式参考源包

## 装配入口

- `u06-inline.html`：咖啡 U06，完整自包含 HTML；替换当前 GLX 中原有 U06 局部程序的 HTML 字段，走正式事务。
- `sugar-inline.html`：同一引擎与同一布局，糖水配置；在独立复用 GLX 中装配。
- `water.js` / `water.css` / `u06.html`：实际可修改源文件；`build-inline.py` 重新生成两个内联文件。
- `water.config.js`：咖啡 200 克 / 3 克可溶物 / 加水上限 100 克。
- `sugar/water.config.js`：糖水 300 克 / 30 克糖 / 加水上限 300 克。

## 实际视觉修改

Canvas 只绘图形：玻璃的前后杯口、折射边缘、厚底、半透明把手、液面与液体深浅、纸滤杯褶皱、咖啡粉、细水流和迁移颗粒。颜色及密度随同一个状态变化。稀释后保留原液面虚线，帮助观察液体扩展；所有数据、图例、阶段标注和不变量都在 DOM 中，避免手机上随 Canvas 缩成小字。

萃取三阶段的状态、时长与原公式保留；稀释保持 `percent = 100 * soluteMass / (baseMass + added)`。稀释全程 72 个可溶物标记，不随浓度减少。加水时短暂水流，插值结束后停止 rAF。声音仍由用户主动触发，旧 sessionStorage key 和状态字段保留。

HTML、body 与 main 都透明；未设置 color-scheme。图解有一个局部半透明阅读面板，既不负责整章底色，也不绘制全幅不透明背景。U06 应使用浅色背景阶段，主体文字仍为原先的深绿色。

## 保持的集成契约

所有原控件 data 选择器、根 `[data-water-lab]`、canvas、`coffee:height` 消息、`data-mode / added / total / solute / concentration / particles / progress / step / playing / audioEvents / shownAdded` 保留。新增 `visibleParticles` 仅作可观察状态，不是第二计算源。配置字段无新增必填项。独立糖水主题只换配置，未复制另一份绘图或计算引擎。

正式 GLX 已保留其外部原生正文、标题、图注身份，只替换 U06 局部程序。高度沿原 coffee:height 回执更新；手机正文、图解和控件按自然顺序排版。复用时应保留这条高度回执，不能把完整桌面画幅整体缩成 390px。

## 验证与复用

正式主作品 r204、糖水小样 r34 均已装配、保存、新进程冷开并由正式导出器生成单文件 HTML。两种宽度的原交互、固定溶质、72标记、声音事件、重置、键盘、返回、减少动态和空闲停止均有实测；糖水还在GLX内完成参数300→360、8.33%读数和Undo/Redo/恢复。完整版本继承与证据见 [VERIFICATION](../../VERIFICATION.md)，最终文件与校验值见 [DELIVERY_MANIFEST](../../DELIVERY_MANIFEST.json)。

手机主图解标题和图例为13px，图注、条件和辅助阶段字为12px；粒子保持在杯体安全区域。数值和操作布局已通过真实顶层viewport目视。不要把跨iframe长元素截图的顶部空白当成作品留白缺陷。

`verify.cjs` 是可选的独立页面复现脚本，可覆盖桌面/390px与两主题行为；它不能替代正式GLX的事务、保存、冷开和离线验收。生成方法为在本目录执行 `python build-inline.py`，再将对应内联HTML经当前工程的正式 `.content.html` 路径提交。修改源码或重新生成不会自动改变GLX。
