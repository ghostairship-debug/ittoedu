(function () {
  function objectValue(value) {
    return value && typeof value === 'object' ? value : {}
  }

  function stringValue(value, fallback) {
    return typeof value === 'string' ? value : fallback
  }

  function numberValue(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }

  var supportedStyles = new Set([
    'transparent-glass',
    'frosted-glass',
    'sticky-note',
    'torn-paper',
    'file-folder'
  ])

  window.CoursewareComponent.define({
    id: 'com.ittoedu.visual.text-container',
    runtimeApiVersion: 4,

    create: function (ctx) {
      if (ctx.renderMode !== 'dom') {
        throw new Error('文字视觉容器必须使用 renderMode=dom')
      }

      var root = ctx.dom.root
      var props = ctx.props
      var destroyed = false

      var style = document.createElement('style')
      style.textContent = [
        ':host{display:block;width:100%;height:100%;contain:layout paint style}',
        '.stage{position:relative;box-sizing:border-box;width:100%;height:100%;padding:2.5%;color:var(--text);font-family:Microsoft YaHei,PingFang SC,Noto Sans CJK SC,sans-serif}',
        '.surface{position:relative;box-sizing:border-box;width:100%;height:100%;filter:drop-shadow(0 16px 26px rgba(28,52,37,var(--shadow)));transition:background .18s ease,border-radius .18s ease,clip-path .18s ease}',
        '.content{position:absolute;inset:0;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;padding:var(--padding)}',
        '.eyebrow{margin:0 0 .38em;color:var(--accent);font-size:var(--eyebrow-size);font-weight:800;letter-spacing:.12em;line-height:1.25;text-transform:uppercase}',
        '.title{margin:0 0 .42em;color:var(--text);font-size:var(--title-size);font-weight:800;line-height:1.25;overflow-wrap:anywhere}',
        '.body{margin:0;color:var(--text);font-size:var(--body-size);line-height:var(--line-height);white-space:pre-wrap;overflow-wrap:anywhere}',
        '.steps{box-sizing:border-box;margin:auto 0 0;padding:.72em .9em .72em 2.1em;border-left:6px solid var(--accent);border-radius:14px;background:rgba(255,255,255,.68);color:var(--text);font-size:var(--step-size);line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}',
        '.stage[data-style="transparent-glass"] .surface{border:2px solid rgba(255,255,255,.88);border-radius:36px;background:linear-gradient(145deg,rgba(255,255,255,.78),rgba(224,245,231,.46));box-shadow:inset 0 1px 0 rgba(255,255,255,.95),inset 0 -1px 0 rgba(255,255,255,.28)}',
        '.stage[data-style="transparent-glass"] .surface::after{content:"";position:absolute;inset:12px;border:1px solid rgba(255,255,255,.42);border-radius:27px;pointer-events:none}',
        '.stage[data-style="frosted-glass"] .surface{border:1px solid rgba(255,255,255,.82);border-radius:46px;background:linear-gradient(135deg,rgba(237,249,239,.72),rgba(209,233,222,.48));box-shadow:inset 0 1px 1px rgba(255,255,255,.9);backdrop-filter:blur(18px) saturate(1.18)}',
        '.stage[data-style="frosted-glass"] .surface::before{content:"";position:absolute;inset:0;border-radius:inherit;background:radial-gradient(circle at 18% 12%,rgba(255,255,255,.62),transparent 34%),radial-gradient(circle at 86% 88%,rgba(116,166,142,.18),transparent 38%);pointer-events:none}',
        '.stage[data-style="sticky-note"]{padding:4% 5%}',
        '.stage[data-style="sticky-note"] .surface{transform:rotate(-.45deg);border-radius:5px 18px 8px 5px;background:linear-gradient(112deg,#fff8db 0%,#fff1b9 78%,#f2d884 100%);box-shadow:inset -18px 0 34px rgba(187,139,44,.08)}',
        '.stage[data-style="sticky-note"] .surface::before{content:"";position:absolute;left:38%;top:-14px;width:24%;height:34px;transform:rotate(1deg);background:rgba(246,228,181,.72);box-shadow:0 1px 3px rgba(65,51,24,.08)}',
        '.stage[data-style="sticky-note"] .content{border-top:8px solid var(--accent)}',
        '.stage[data-style="torn-paper"]{padding:3.5%}',
        '.stage[data-style="torn-paper"] .surface{clip-path:polygon(1.5% 6%,7% 2%,14% 4%,21% 1%,31% 4%,40% 1%,49% 3%,58% 1%,68% 4%,77% 2%,87% 5%,98% 2%,96% 15%,99% 26%,96% 39%,99% 52%,96% 65%,98% 78%,95% 91%,86% 97%,76% 94%,66% 98%,56% 95%,46% 98%,35% 95%,25% 99%,15% 95%,3% 98%,5% 85%,2% 72%,5% 59%,2% 47%,5% 34%,2% 20%);background:linear-gradient(112deg,#fffef9,#f6f0df 74%,#ebe0c8);box-shadow:inset 0 0 48px rgba(117,91,47,.08)}',
        '.stage[data-style="torn-paper"] .surface::before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(8deg,transparent 0 8px,rgba(112,88,49,.025) 9px 10px);pointer-events:none}',
        '.stage[data-style="file-folder"]{padding:7% 4% 3%}',
        '.stage[data-style="file-folder"] .surface{border-radius:12px 18px 16px 12px;background:linear-gradient(155deg,#e2bd6c,#c99543);box-shadow:inset 0 2px 0 rgba(255,244,199,.36)}',
        '.stage[data-style="file-folder"] .surface::before{content:"";position:absolute;left:4%;top:-11%;width:32%;height:18%;border-radius:16px 26px 0 0;background:#d7aa55}',
        '.stage[data-style="file-folder"] .content{inset:5% 6% 4%;border:1px solid rgba(109,81,35,.16);border-radius:7px;background:linear-gradient(165deg,#fffef9,#f5efe1);box-shadow:0 7px 16px rgba(80,58,24,.15);transform:rotate(-.35deg)}',
        '[hidden]{display:none!important}',
        '@media(max-width:620px){.stage{padding:2%}.content{padding:max(14px,var(--padding))}}'
      ].join('')

      var stage = document.createElement('section')
      stage.className = 'stage'
      var surface = document.createElement('div')
      surface.className = 'surface'
      var contentRoot = document.createElement('div')
      contentRoot.className = 'content'

      var eyebrow = document.createElement('div')
      eyebrow.className = 'eyebrow'
      eyebrow.dataset.coursewareEditKey = 'content.eyebrow'
      eyebrow.dataset.coursewareEditLabel = '眉题'
      var title = document.createElement('h2')
      title.className = 'title'
      title.dataset.coursewareEditKey = 'content.title'
      title.dataset.coursewareEditLabel = '标题'
      var body = document.createElement('p')
      body.className = 'body'
      body.dataset.coursewareEditKey = 'content.body'
      body.dataset.coursewareEditLabel = '正文'
      body.dataset.coursewareEditMultiline = 'true'
      var steps = document.createElement('div')
      steps.className = 'steps'
      steps.dataset.coursewareEditKey = 'content.steps'
      steps.dataset.coursewareEditLabel = '步骤'
      steps.dataset.coursewareEditMultiline = 'true'

      contentRoot.append(eyebrow, title, body, steps)
      surface.append(contentRoot)
      stage.append(surface)
      root.replaceChildren(style, stage)

      function render() {
        var values = objectValue(objectValue(props).content)
        var visualStyle = stringValue(props.visualStyle, 'transparent-glass')
        stage.dataset.style = supportedStyles.has(visualStyle)
          ? visualStyle
          : 'transparent-glass'
        stage.style.setProperty('--padding', numberValue(props.padding, 42) + 'px')
        stage.style.setProperty('--eyebrow-size', numberValue(props.eyebrowSize, 22) + 'px')
        stage.style.setProperty('--title-size', numberValue(props.titleSize, 34) + 'px')
        stage.style.setProperty('--body-size', numberValue(props.bodySize, 28) + 'px')
        stage.style.setProperty('--step-size', numberValue(props.stepSize, 24) + 'px')
        stage.style.setProperty('--line-height', String(numberValue(props.lineHeight, 1.65)))
        stage.style.setProperty('--text', stringValue(props.textColor, '#173d2a'))
        stage.style.setProperty('--accent', stringValue(props.accentColor, '#d95d42'))
        stage.style.setProperty('--shadow', String(numberValue(props.shadowOpacity, 0.2)))
        eyebrow.hidden = props.showEyebrow !== true
        title.hidden = props.showTitle === false
        body.hidden = props.showBody === false
        steps.hidden = props.showSteps !== true
        eyebrow.textContent = stringValue(values.eyebrow, '')
        title.textContent = stringValue(values.title, '')
        body.textContent = stringValue(values.body, '')
        steps.textContent = stringValue(values.steps, '')
      }

      render()
      ctx.capture.waitUntil(document.fonts && document.fonts.ready
        ? document.fonts.ready
        : Promise.resolve())

      return {
        setMode: function () {},
        resize: function () { render() },
        updateProps: function (nextProps) { props = nextProps; render() },
        setVisible: function (visible) {
          root.style.display = visible ? '' : 'none'
          root.style.pointerEvents = visible ? '' : 'none'
        },
        suspend: function () {},
        resume: function () {},
        prepareCapture: function () { render() },
        destroy: function () {
          if (destroyed) return
          destroyed = true
          root.replaceChildren()
        }
      }
    }
  })
})()
