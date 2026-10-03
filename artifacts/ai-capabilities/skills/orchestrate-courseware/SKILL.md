---
name: orchestrate-courseware
description: 根据教材、教案、主题或教学材料创作内容完整、视觉清晰的互动课件；负责内容、布局和互动设计，用普通 HTML/CSS 表达作品，再交给宿主组装保存。
---

# 创作教学作品

先读取用户材料和有效约束，复用已有策划与素材。默认面向教师演示；自主学习或测验按用户要求组织。想清学习目标、内容主线、视觉重点和互动作用，随即创作；用户需要时才把详细策划、讲稿另存文件。用户要求阶段审阅时在相应阶段等待，不固定插入两次确认。

模型负责文案、图示、视觉风格、布局关系和互动行为。用熟悉的 HTML、CSS、SVG 和必要的 JavaScript 表达作品；用 Grid、Flex、自然文档流、尺寸约束或确有需要的自由定位表达布局。字号、色彩、间距和宽度比例属于设计，派生坐标、工程身份、素材登记和保存由软件处理。未指定规格的教师演示默认按 1280×720 设计；长文阅读优先连续正文/Flow，不固定高度裁切。明确要求的竖屏、长页或自定义规格优先。

每个新概念都要有足以支持教学的解释、图示、示范或实验。关键知识不能只出现在答案反馈或素材说明中；不以“想象图甲”代替图甲。比较时保持其他条件一致，说明单位、条件和判断依据。让操作带来真实可见的证据变化，反馈回应实际选择，并支持必要的重试或重置。教学难点不明确时再参考[教学质量](references/teaching-design-quality.md)；需要实验、探索或决策时参考[互动设计](references/interaction-design.md)。

直接呈现核心图示。SVG、CSS 与程序绘图均可作为作品内容；已有优质素材或组件适合当前目标时复用。需要可直接改数据的原生图表或语义正文时，可选用[短组件表达](references/web-composition-examples.md)；普通 HTML 和第三方内容不需要使用这些标签。自动编号、登记与内部工程参数不交给模型。

在用户工作区形成可交付 HTML 与所需资源。独立教学页可用普通 `section` 组织，具体分页边界见 [HTML 输入与分页](../build-courseware-project/references/html-draft-contract.md)。共享状态或跨页程序需要整体运行时保留其逻辑，不为了拆页破坏作品。教师演示允许正常翻页，只有自主学习要求时才设计完成门槛；相关方法见[教学推进](references/main-progression.md)。

如果内容已经分成正文片段、CSS 和 JS，可使用 [assemble-html.mjs](scripts/assemble-html.mjs) 组装标准文档：

```text
node <skill目录>/scripts/assemble-html.mjs --body body.html --css theme.css --js lesson.js --out lesson.html --title "斜抛运动"
```

这是可选的内容组装工具，只在当前环境有已授权命令执行通道时运行；读取 Skill 不等于执行脚本。正文中的相对资源路径以输出 HTML 所在目录为基准。已有完整 HTML 直接使用，无需经过此脚本。

通过 `build-courseware-project` 的 `course.createFromHtml` 交付真实工程。观察应解决具体内容、视觉或互动问题：检查主要图示、文字容量和关键互动，只修可见问题及其影响范围。保持作品的审美与表达自由，不为读取全套软件说明、固定审批回合或无问题的反复检查占用创作过程。
