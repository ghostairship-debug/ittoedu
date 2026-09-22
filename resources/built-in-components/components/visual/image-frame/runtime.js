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

  window.CoursewareComponent.define({
    id: 'com.ittoedu.visual.image-frame',
    runtimeApiVersion: 4,

    create: function (ctx) {
      if (ctx.renderMode !== 'dom') {
        throw new Error('图片装饰容器必须使用 renderMode=dom')
      }

      var root = ctx.dom.root
      var props = ctx.props
      var destroyed = false
      var filterId = 'image-frame-' + String(ctx.instanceId).replace(/[^A-Za-z0-9_-]/g, '-')

      var style = document.createElement('style')
      style.textContent = [
        ':host{display:block;width:100%;height:100%;contain:layout paint style}',
        '.stage{position:relative;box-sizing:border-box;width:100%;height:100%;padding:4%;font-family:Microsoft YaHei,PingFang SC,Noto Sans CJK SC,sans-serif}',
        '.picture{position:relative;box-sizing:border-box;width:100%;height:calc(100% - var(--caption-space));isolation:isolate}',
        '.picture img,.placeholder{display:block;box-sizing:border-box;width:100%;height:100%;object-position:var(--position-x) var(--position-y)}',
        '.placeholder{background:radial-gradient(circle at 72% 28%,rgba(255,244,190,.9),transparent 18%),linear-gradient(145deg,#b8d9ec,#f3d989 46%,#5d9465 47%,#2f6f4e)}',
        '.caption{box-sizing:border-box;min-height:var(--caption-space);padding:.45em .8em 0;color:var(--caption-color);font-size:var(--caption-size);font-weight:800;line-height:1.25;text-align:center;overflow-wrap:anywhere}',
        '.stage[data-style="brush"] .picture{clip-path:polygon(2% 14%,9% 8%,17% 11%,27% 5%,38% 9%,49% 4%,61% 8%,73% 3%,86% 10%,98% 6%,94% 20%,99% 31%,94% 43%,98% 56%,93% 68%,97% 82%,88% 91%,74% 87%,62% 96%,49% 90%,37% 97%,24% 89%,11% 94%,3% 86%,7% 72%,2% 61%,6% 48%,1% 36%,6% 25%);filter:drop-shadow(0 var(--shadow-distance) 14px rgba(39,73,51,var(--shadow-opacity)))}',
        '.stage[data-style="brush"] .picture::after{content:"";position:absolute;left:3%;right:1%;bottom:2%;height:7%;z-index:2;background:linear-gradient(90deg,var(--accent),transparent 78%);clip-path:polygon(0 38%,72% 0,100% 45%,69% 62%,17% 100%);opacity:.82;pointer-events:none}',
        '.stage[data-style="sticker"]{padding:7%}',
        '.stage[data-style="sticker"] .picture{filter:url(#' + filterId + ')}',
        '.stage[data-style="sticker"] .picture img,.stage[data-style="sticker"] .placeholder{object-fit:contain}',
        '.stage[data-style="sticker"] .caption{padding-top:.7em}',
        '[hidden]{display:none!important}'
      ].join('')

      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('width', '0')
      svg.setAttribute('height', '0')
      svg.setAttribute('aria-hidden', 'true')
      var filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter')
      filter.setAttribute('id', filterId)
      filter.setAttribute('x', '-40%')
      filter.setAttribute('y', '-40%')
      filter.setAttribute('width', '180%')
      filter.setAttribute('height', '180%')
      filter.setAttribute('color-interpolation-filters', 'sRGB')
      var morphology = document.createElementNS('http://www.w3.org/2000/svg', 'feMorphology')
      morphology.setAttribute('in', 'SourceAlpha')
      morphology.setAttribute('operator', 'dilate')
      morphology.setAttribute('result', 'expanded')
      var paperFlood = document.createElementNS('http://www.w3.org/2000/svg', 'feFlood')
      paperFlood.setAttribute('result', 'paper')
      var paperComposite = document.createElementNS('http://www.w3.org/2000/svg', 'feComposite')
      paperComposite.setAttribute('in', 'paper')
      paperComposite.setAttribute('in2', 'expanded')
      paperComposite.setAttribute('operator', 'in')
      paperComposite.setAttribute('result', 'outline')
      var blur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur')
      blur.setAttribute('in', 'expanded')
      blur.setAttribute('stdDeviation', '9')
      blur.setAttribute('result', 'blur')
      var offset = document.createElementNS('http://www.w3.org/2000/svg', 'feOffset')
      offset.setAttribute('in', 'blur')
      offset.setAttribute('result', 'offsetBlur')
      var shadowFlood = document.createElementNS('http://www.w3.org/2000/svg', 'feFlood')
      shadowFlood.setAttribute('flood-color', '#294932')
      shadowFlood.setAttribute('result', 'shadowColor')
      var shadowComposite = document.createElementNS('http://www.w3.org/2000/svg', 'feComposite')
      shadowComposite.setAttribute('in', 'shadowColor')
      shadowComposite.setAttribute('in2', 'offsetBlur')
      shadowComposite.setAttribute('operator', 'in')
      shadowComposite.setAttribute('result', 'shadow')
      var merge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge')
      ;['shadow', 'outline', 'SourceGraphic'].forEach(function (source) {
        var node = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode')
        node.setAttribute('in', source)
        merge.append(node)
      })
      filter.append(morphology, paperFlood, paperComposite, blur, offset, shadowFlood, shadowComposite, merge)
      var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
      defs.append(filter)
      svg.append(defs)

      var stage = document.createElement('section')
      stage.className = 'stage'
      var picture = document.createElement('div')
      picture.className = 'picture'
      picture.setAttribute('role', 'img')
      var image = document.createElement('img')
      image.decoding = 'async'
      var placeholder = document.createElement('div')
      placeholder.className = 'placeholder'
      placeholder.setAttribute('aria-hidden', 'true')
      var caption = document.createElement('div')
      caption.className = 'caption'
      caption.dataset.coursewareEditKey = 'content.caption'
      caption.dataset.coursewareEditLabel = '图片标题'
      picture.append(image, placeholder)
      stage.append(picture, caption)
      root.replaceChildren(style, svg, stage)

      function render() {
        var values = objectValue(objectValue(props).content)
        var visualStyle = props.visualStyle === 'sticker' ? 'sticker' : 'brush'
        var imageAssetId = stringValue(props.imageAssetId, '')
        var hasImage = Boolean(imageAssetId)
        stage.dataset.style = visualStyle
        stage.style.setProperty('--caption-space', props.showCaption === false ? '0px' : '3.2em')
        stage.style.setProperty('--caption-size', numberValue(props.captionSize, 28) + 'px')
        stage.style.setProperty('--caption-color', stringValue(props.captionColor, '#2f6f4e'))
        stage.style.setProperty('--accent', stringValue(props.accentColor, '#d95d42'))
        stage.style.setProperty('--position-x', numberValue(props.positionX, 50) + '%')
        stage.style.setProperty('--position-y', numberValue(props.positionY, 50) + '%')
        stage.style.setProperty('--shadow-opacity', props.shadowEnabled === false ? '0' : String(numberValue(props.shadowOpacity, 0.22)))
        stage.style.setProperty('--shadow-distance', numberValue(props.shadowDistance, 12) + 'px')
        image.hidden = !hasImage
        placeholder.hidden = hasImage
        if (hasImage) image.src = ctx.projectAssetUrl(imageAssetId)
        else image.removeAttribute('src')
        image.style.objectFit = props.fit === 'contain' ? 'contain' : 'cover'
        picture.setAttribute('aria-label', stringValue(values.alt, ''))
        caption.hidden = props.showCaption === false
        caption.textContent = stringValue(values.caption, '')
        morphology.setAttribute('radius', String(numberValue(props.borderWidth, 12)))
        paperFlood.setAttribute('flood-color', stringValue(props.borderColor, '#fffdf6'))
        offset.setAttribute('dy', String(numberValue(props.shadowDistance, 12)))
        shadowFlood.setAttribute('flood-opacity', props.shadowEnabled === false
          ? '0'
          : String(numberValue(props.shadowOpacity, 0.22)))
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
