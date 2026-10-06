# 普通布局与可选专业内容

普通 HTML 可以直接创作；Grid、Flex、SVG、CSS 效果和必要的程序逻辑都是作品表达。以下例子是可组合片段，不是必须套用的模板。

```html
<style>
  .lesson { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: 2rem; }
  .lesson h1 { grid-column: 1 / -1; }
  .lesson > * { min-width: 0; }
  @media (max-width: 680px) { .lesson { grid-template-columns: 1fr; } }
</style>
<section class="lesson">
  <h1>比较两组观察结果</h1>
  <p>保持其他条件一致，比较哪一组变化更明显，并说明证据。</p>
  <figure>
    <svg viewBox="0 0 240 140" role="img" aria-label="甲组记录3次，乙组记录5次">
      <rect x="44" y="62" width="48" height="54" fill="#93c5fd"/>
      <rect x="148" y="26" width="48" height="90" fill="#2563eb"/>
      <text x="68" y="134" text-anchor="middle">甲组：3次</text>
      <text x="172" y="134" text-anchor="middle">乙组：5次</text>
    </svg>
  </figure>
</section>
```

只有希望复用软件的图表数据编辑能力时，使用 `guoling-chart`。类别、系列和数据点身份及默认样式由软件建立；值的数量对应类别数。外围元素用 CSS 指定实际宽高，图表类型支持 bar、line、area、pie、donut，pie/donut 使用一个系列。

```html
<guoling-chart style="display:block;width:100%;height:320px">
  <script type="application/json">
  {
    "chartType": "bar",
    "title": "观察结果",
    "categories": ["甲组", "乙组"],
    "series": [{"name":"次数","color":"#2563eb","values":[3,5]}]
  }
  </script>
</guoling-chart>
```

需要语义正文编辑时，可使用 `guoling-document`。普通文字仍可直接写成 p、h2、ul 等 HTML；这个可选表达只在需要专业正文能力时使用。普通段落、标题、列表等缺少的内部编号由软件生成。

```html
<guoling-document style="display:block">
  <script type="application/json">
  {"blocks":[
    {"type":"heading","level":2,"content":{"inlines":[{"type":"text","text":"观察结论"}]}},
    {"type":"paragraph","content":{"inlines":[{"type":"text","text":"乙组记录到的次数更多，但尚需更多重复实验。"}]}}
  ]}
  </script>
</guoling-document>
```

这些 JSON 数据块不会执行 JavaScript。数据有具体错误时宿主给出诊断并保留原始内容；不能把诊断当成组件已经建立成功。普通第三方 HTML 不需要增加这些标签。

原生表单和 CSS 状态互动也可以直接表达。下面的单选按钮属于同一表单、共用 `name`，反馈由 `:checked` 决定；原生重置恢复默认选择，不需要脚本。

```html
<style>
  .choice-demo .feedback { display: none; }
  .choice-demo #choice-a:checked ~ .answer-a,
  .choice-demo #choice-b:checked ~ .answer-b { display: block; }
</style>
<form class="choice-demo">
  <fieldset>
    <legend>选择一个观察结果</legend>
    <input type="radio" id="choice-a" name="observation" checked>
    <label for="choice-a">甲组</label>
    <input type="radio" id="choice-b" name="observation">
    <label for="choice-b">乙组</label>
    <p class="feedback answer-a">当前选择：甲组。</p>
    <p class="feedback answer-b">当前选择：乙组。请说明你的观察依据。</p>
    <button type="reset">恢复默认选择</button>
  </fieldset>
</form>
```

软件保留原生 form owner、label 与 control 的关联、同组 radio 和依赖状态的 CSS 为可继续编辑的语义组。依赖祖先选择器、外部上下文或状态变化会影响后文布局时，保留共同源文范围；独立文本、图像或 SVG 继续沿用现有内容装配。这些关联与共同源文范围由软件识别，不需要额外编号或登记。

继续修改该组时，从 `project.list/read` 取得实际对象 `.content.html`，读取完整当前源文后用 `project.apply {path, intent:"content", content:"修改后的完整源文"}` 提交。组内 HTML/CSS 通过源文编辑，保留该组的正式 frame 和邻项；这不代表组内每个 DOM 元素都成为可分别拖拽的正式对象。需要移动整个自由对象时用[工程路径与 frame](project-files.md)入口。含脚本或事件处理器的耦合内容沿现有整体程序路径保留，不拆解任意 JavaScript 的依赖。

局部互动具有自己的内容与状态时，可以使用标准 iframe 引用同目录或子目录下的独立 HTML。两份文件可直接在普通浏览器中运行；外层静态布局、正文和专业组件仍可编辑，软件负责互动文档的资源闭包、Runtime 封装与准入，不需要编号、登记或编写宿主协议。

```html
<section style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
  <p>先预测，再点击按钮观察记录。</p>
  <iframe src="experiment.html" title="观察实验"
          style="width:100%;height:180px;border:0"></iframe>
</section>
```

对应的 `experiment.html` 使用普通 HTML、CSS 和 JS，例如：

```html
<!doctype html>
<html lang="zh"><body style="margin:0;font:24px sans-serif">
  <button id="observe">观察次数：0</button>
  <script>
    let count = 0;
    const button = document.getElementById('observe');
    button.addEventListener('click', () => button.textContent = '观察次数：' + ++count);
  </script>
</body></html>
```

希望只交付一份文件时，也可使用标准 `iframe srcdoc`。尺寸由外层 CSS 或 width/height 表达；内部资源相对独立 HTML 的目录解析，srcdoc 中的资源相对外层文件解析。需要跨块共用脚本、访问外层 DOM 或共享程序状态时保留整体程序，不为拆块破坏依赖。整份 HTML 含有外层程序行为时由现有 Runtime 整体承载，不能假定其中的短标签已经转成专业组件。
