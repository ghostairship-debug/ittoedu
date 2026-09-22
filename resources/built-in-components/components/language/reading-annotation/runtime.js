(function () {
  function objectValue(value) {
    return value && typeof value === 'object' ? value : {}
  }

  function stringValue(value) {
    return typeof value === 'string' ? value : ''
  }

  function numberValue(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }

  function tokenize(markup) {
    var result = []
    var plain = ''
    var flush = function () {
      if (!plain) return
      result.push({ type: 'text', value: plain })
      plain = ''
    }
    var index = 0
    while (index < markup.length) {
      if (markup.startsWith('**', index)) {
        var emphasisEnd = markup.indexOf('**', index + 2)
        if (emphasisEnd >= 0) {
          flush()
          result.push({
            type: 'emphasis',
            value: markup.slice(index + 2, emphasisEnd)
          })
          index = emphasisEnd + 2
          continue
        }
      }
      if (markup[index] === '~') {
        var liaisonEnd = markup.indexOf('~', index + 1)
        if (liaisonEnd >= 0) {
          flush()
          result.push({
            type: 'liaison',
            value: markup.slice(index + 1, liaisonEnd)
          })
          index = liaisonEnd + 1
          continue
        }
      }
      if (markup.startsWith('//', index)) {
        flush()
        result.push({ type: 'pause', value: '' })
        index += 2
        continue
      }
      if (markup[index] === '\n') {
        flush()
        result.push({ type: 'break', value: '' })
        index += 1
        continue
      }
      plain += markup[index]
      index += 1
    }
    flush()
    return result
  }

  function liaisonSvg() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 100 20')
    svg.setAttribute('preserveAspectRatio', 'none')
    svg.setAttribute('aria-hidden', 'true')
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', 'M16 17 Q50 2 84 17')
    path.setAttribute('fill', 'none')
    path.setAttribute('vector-effect', 'non-scaling-stroke')
    svg.append(path)
    return svg
  }

  window.CoursewareComponent.define({
    id: 'com.ittoedu.language.reading-annotation',
    runtimeApiVersion: 4,

    create: function (ctx) {
      if (ctx.renderMode !== 'dom') {
        throw new Error('朗读标注组件必须使用 renderMode=dom')
      }

      var root = ctx.dom.root
      var props = ctx.props
      var destroyed = false

      var style = document.createElement('style')
      style.textContent = [
        ':host{display:block;width:100%;height:100%;contain:layout paint style}',
        '.shell{box-sizing:border-box;width:100%;height:100%;overflow:auto;padding:var(--padding);border:2px solid var(--border);border-radius:24px;background:var(--surface);color:var(--text);font-family:Microsoft YaHei,PingFang SC,Noto Sans CJK SC,sans-serif}',
        '.head{display:flex;align-items:center;justify-content:space-between;gap:22px;margin:0 0 14px}',
        'h2{margin:0;font-size:var(--title-size);line-height:1.3;color:var(--text)}',
        '.legend{display:flex;align-items:center;flex-wrap:wrap;gap:9px 17px;color:var(--text);font-size:var(--legend-size)}',
        '.legend-item{display:inline-flex;align-items:center;gap:7px;white-space:nowrap}',
        '.legend-mark{position:relative;display:inline-block;width:24px;height:18px;flex:0 0 auto;color:var(--mark)}',
        '.legend-dot::after{content:"";position:absolute;left:9px;bottom:2px;width:6px;height:6px;border-radius:50%;background:currentColor}',
        '.legend-pause{width:auto;height:auto;font-size:1em;font-weight:800;line-height:1}',
        '.legend-arc svg{position:absolute;inset:1px 0 auto;width:100%;height:15px;overflow:visible}',
        '.legend-arc path,.liaison svg path{stroke:var(--mark);stroke-width:3;stroke-linecap:round}',
        '.reading-text{box-sizing:border-box;min-height:calc(100% - 54px);padding:.34em .12em .46em;font-size:var(--font-size);line-height:var(--line-height);white-space:pre-wrap;overflow-wrap:anywhere;letter-spacing:.03em}',
        '.emphasis{text-emphasis:filled dot var(--mark);text-emphasis-position:under right;-webkit-text-emphasis:filled dot var(--mark);-webkit-text-emphasis-position:under right}',
        '.pause{display:inline-block;margin:0 .14em;color:var(--mark);font-size:1em;font-weight:800;letter-spacing:-.08em;vertical-align:.02em}',
        '.liaison{position:relative;display:inline-block}',
        '.liaison svg{position:absolute;left:7%;top:-.43em;width:86%;height:.38em;overflow:visible;pointer-events:none}',
        '@media(max-width:720px){.head{align-items:flex-start;flex-direction:column}.shell{border-radius:16px}}'
      ].join('')

      var shell = document.createElement('section')
      shell.className = 'shell'
      var head = document.createElement('header')
      head.className = 'head'
      var title = document.createElement('h2')
      title.dataset.coursewareEditKey = 'content.title'
      title.dataset.coursewareEditLabel = '标题'
      var legend = document.createElement('div')
      legend.className = 'legend'
      var body = document.createElement('div')
      body.className = 'reading-text'
      body.dataset.coursewareEditKey = 'content.markup'
      body.dataset.coursewareEditLabel = '朗读标注文稿'
      body.dataset.coursewareEditMultiline = 'true'
      head.append(title, legend)
      shell.append(head, body)
      root.replaceChildren(style, shell)

      function content() {
        return objectValue(objectValue(props).content)
      }

      function legendItem(className, label, visibleSymbol, contentKey) {
        var item = document.createElement('span')
        item.className = 'legend-item'
        var mark = document.createElement('span')
        mark.className = 'legend-mark ' + className
        mark.setAttribute('aria-hidden', 'true')
        if (className === 'legend-arc') mark.append(liaisonSvg())
        if (className === 'legend-pause') {
          mark.textContent = visibleSymbol
          mark.dataset.coursewareEditKey = 'content.pauseSymbol'
          mark.dataset.coursewareEditLabel = '较长停顿符号'
        }
        var text = document.createElement('span')
        text.textContent = label
        text.dataset.coursewareEditKey = contentKey
        text.dataset.coursewareEditLabel = label
        item.append(mark, text)
        return item
      }

      function render() {
        var values = content()
        shell.style.setProperty('--padding', numberValue(props.padding, 34) + 'px')
        shell.style.setProperty('--font-size', numberValue(props.fontSize, 42) + 'px')
        shell.style.setProperty('--title-size', numberValue(props.titleSize, 24) + 'px')
        shell.style.setProperty('--legend-size', numberValue(props.legendSize, 24) + 'px')
        shell.style.setProperty('--line-height', String(numberValue(props.lineHeight, 1.85)))
        shell.style.setProperty('--text', stringValue(props.textColor) || '#17324d')
        shell.style.setProperty('--mark', stringValue(props.markColor) || '#d94f3d')
        shell.style.setProperty('--surface', stringValue(props.surface) || '#fffdf7')
        shell.style.setProperty('--border', stringValue(props.borderColor) || '#c9d9cd')
        shell.setAttribute('aria-label', stringValue(values.ariaLabel))
        head.hidden = props.showTitle !== true && props.showLegend !== true
        title.hidden = props.showTitle !== true
        title.textContent = stringValue(values.title)

        legend.hidden = props.showLegend !== true
        legend.replaceChildren(
          legendItem('legend-dot', stringValue(values.legendEmphasis), '', 'content.legendEmphasis'),
          legendItem('legend-pause', stringValue(values.legendPause), stringValue(values.pauseSymbol), 'content.legendPause'),
          legendItem('legend-arc', stringValue(values.legendLiaison), '', 'content.legendLiaison')
        )

        var nodes = tokenize(stringValue(values.markup)).map(function (token) {
          if (token.type === 'break') return document.createElement('br')
          if (token.type === 'pause') {
            var pause = document.createElement('span')
            pause.className = 'pause'
            pause.textContent = stringValue(values.pauseSymbol)
            return pause
          }
          var span = document.createElement('span')
          span.textContent = token.value
          if (token.type === 'emphasis') span.className = 'emphasis'
          if (token.type === 'liaison') {
            span.className = 'liaison'
            span.prepend(liaisonSvg())
          }
          return span
        })
        body.replaceChildren.apply(body, nodes)
      }

      render()
      ctx.capture.waitUntil(document.fonts && document.fonts.ready
        ? document.fonts.ready
        : Promise.resolve())

      return {
        setMode: function () {},
        resize: function () { render() },
        updateProps: function (nextProps) {
          props = nextProps
          render()
        },
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
