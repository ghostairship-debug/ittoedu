# HTML 初稿的最小承载合同

- `<body>` 的顶层 `<section>`（或唯一 main 中的直接 section）依次对应课件页；每页有真实标题、文案和核心图示。共用 CSS 可以放 head。页外不放无法归属的页头、按钮和教学正文。
- 每页在独立 iframe 内也可见；不使用全局 `.page{display:none}` 与 `.active` 控制整课翻页。演示页按实际画布尺寸布局，自然长页交给 Flow；不把长页内容截掉冒充适配。
- 页内脚本就近放在 section 中，通过 `document.currentScript.closest('section')` 取得本页根。查询与状态限定在本页。共享初始化只遍历实际存在的页，不引用已经拆走的其他页元素。
- 教师演示使用正式播放器翻页、快捷键或控制器；不需要另写一套跨页 pages 数组。自学内容确需跨页动作时，通过已支持的正式导航完成；不能把整页 JS 原样复制后假定跨 iframe 有共享变量。
- SVG 和普通 DOM 图文直接形成核心教学呈现；宿主自动发现可编辑文字和图片，无需模型登记可编辑编号。data-role 等页内代码定位不等于编辑目标登记。
- 属性中的引号按 HTML 规则转义（如 `&quot;`），避免选项解释等长文字截断属性。
- 不加载远程脚本，不在源码中写凭据。导入报错保留源文和互动，不以删除 script、截图静态化或叠加另一套 Native 按钮规避问题。

页内初始化例子（演示写法，不限制教学结构）：
```html
<section><h2>观察与验证</h2><p data-role="feedback">先观察图示。</p>
<button type="button">验证</button>
<script>(()=>{const page=document.currentScript.closest('section');
page.querySelector('button').addEventListener('click',()=>{
page.querySelector('[data-role="feedback"]').textContent='显示本题的实际解释与证据。';
});})();</script></section>
```

默认交付内容完整的初稿。软件机械检查不是 AI 审美精修；复杂跨页逻辑无法保证等价时报告具体依赖，不能静默改成单页。
