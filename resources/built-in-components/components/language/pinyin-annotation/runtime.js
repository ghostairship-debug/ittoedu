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

  function parsePairs(value) {
    return value.split(/\r?\n/).map(function (line) {
      var trimmed = line.trim()
      if (!trimmed) return []
      return trimmed.split(/\s+/).map(function (unit) {
        var separator = unit.indexOf('|')
        return separator < 0
          ? { hanzi: unit, pinyin: '' }
          : {
              hanzi: unit.slice(0, separator),
              pinyin: unit.slice(separator + 1)
            }
      })
    })
  }

  window.CoursewareComponent.define({
    id: 'com.ittoedu.language.pinyin-annotation',
    runtimeApiVersion: 4,

    create: function (ctx) {
      if (ctx.renderMode !== 'dom') {
        throw new Error('汉语拼音标注组件必须使用 renderMode=dom')
      }

      var root = ctx.dom.root
      var props = ctx.props
      var destroyed = false
      var pinyinVisible = props.showPinyin !== false
      var locallyHidden = new Set()

      var style = document.createElement('style')
      style.textContent = [
        ':host{display:block;width:100%;height:100%;contain:layout paint style}',
        '.shell{box-sizing:border-box;width:100%;height:100%;overflow:hidden;padding:var(--padding);border:2px solid var(--border);border-radius:24px;background:var(--surface);font-family:Microsoft YaHei,PingFang SC,Noto Sans CJK SC,sans-serif}',
        'h2{margin:0 0 20px;color:var(--hanzi);font-size:24px;line-height:1.3}',
        '.lines{display:flex;flex-direction:column;gap:var(--line-gap)}',
        '.line{display:flex;align-items:flex-end;flex-wrap:wrap;column-gap:var(--unit-gap);row-gap:18px;min-height:calc(var(--hanzi-size) + var(--pinyin-size) + 8px)}',
        'ruby{display:inline-flex;flex-direction:column-reverse;align-items:center;justify-content:flex-end;color:var(--hanzi);font-size:var(--hanzi-size);line-height:1;white-space:nowrap;ruby-align:center}',
        'rt{display:block;min-height:1em;margin:0 0 7px;color:var(--pinyin);font-family:Arial,Microsoft YaHei,sans-serif;font-size:var(--pinyin-size);font-weight:600;line-height:1.05;letter-spacing:.02em;text-align:center}',
        '.pinyin-hidden rt,.unit-hidden rt{visibility:hidden}',
        '.clickable ruby{cursor:pointer;border-radius:8px}',
        '.clickable ruby:focus-visible{outline:3px solid var(--pinyin);outline-offset:4px}',
        '.global-controls{position:absolute;right:18px;top:14px;display:flex;gap:10px;z-index:2}',
        '.global-controls[hidden]{display:none}',
        '.global-controls button{min-height:42px;padding:7px 15px;border:1px solid var(--border);border-radius:999px;background:rgba(255,253,247,.92);color:var(--hanzi);font:700 22px/1 Microsoft YaHei,PingFang SC,Noto Sans CJK SC,sans-serif;cursor:pointer}',
        '.global-controls button:hover,.global-controls button:focus-visible{border-color:var(--pinyin);outline:none;box-shadow:0 0 0 3px rgba(217,79,61,.13)}',
        '@media(max-width:620px){.shell{border-radius:16px}}'
      ].join('')

      var shell = document.createElement('section')
      shell.className = 'shell'
      shell.style.position = 'relative'
      var title = document.createElement('h2')
      title.dataset.coursewareEditKey = 'content.title'
      title.dataset.coursewareEditLabel = '标题'
      var lines = document.createElement('div')
      lines.className = 'lines'
      lines.dataset.coursewareEditKey = 'content.pairs'
      lines.dataset.coursewareEditLabel = '汉字与拼音'
      lines.dataset.coursewareEditMultiline = 'true'
      var controls = document.createElement('div')
      controls.className = 'global-controls'
      var showAll = document.createElement('button')
      showAll.type = 'button'
      showAll.dataset.coursewareEditKey = 'content.showAllLabel'
      showAll.dataset.coursewareEditLabel = '显示拼音按钮'
      var hideAll = document.createElement('button')
      hideAll.type = 'button'
      hideAll.dataset.coursewareEditKey = 'content.hideAllLabel'
      hideAll.dataset.coursewareEditLabel = '隐藏拼音按钮'
      controls.append(showAll, hideAll)
      shell.append(title, controls, lines)
      root.replaceChildren(style, shell)

      function content() {
        return objectValue(objectValue(props).content)
      }

      function applyPinyinVisibility() {
        shell.classList.toggle('pinyin-hidden', !pinyinVisible)
        shell.classList.toggle('clickable', props.clickTogglesPinyin === true)
        controls.hidden = props.showGlobalControls !== true
      }

      function setGlobalVisibility(visible) {
        pinyinVisible = visible
        locallyHidden.clear()
        applyPinyinVisibility()
        lines.querySelectorAll('ruby').forEach(function (ruby) {
          ruby.classList.remove('unit-hidden')
        })
      }

      function broadcastVisibility(visible) {
        eventTarget.dispatchEvent(new CustomEvent('courseware:pinyin-visibility', { detail: { visible: visible } }))
      }

      function handleGlobalVisibility(event) {
        if (!event || !event.detail || typeof event.detail.visible !== 'boolean') return
        setGlobalVisibility(event.detail.visible)
      }

      showAll.addEventListener('click', function (event) { event.stopPropagation(); broadcastVisibility(true) })
      hideAll.addEventListener('click', function (event) { event.stopPropagation(); broadcastVisibility(false) })
      var eventTarget = window && typeof window.addEventListener === 'function' ? window : root
      eventTarget.addEventListener('courseware:pinyin-visibility', handleGlobalVisibility)
      shell.addEventListener('click', function (event) {
        if (props.clickTogglesPinyin !== true || event.target !== shell) return
        broadcastVisibility(!pinyinVisible)
      })

      function render() {
        var values = content()
        shell.style.setProperty('--padding', numberValue(props.padding, 32) + 'px')
        shell.style.setProperty('--hanzi-size', numberValue(props.hanziSize, 48) + 'px')
        shell.style.setProperty('--pinyin-size', numberValue(props.pinyinSize, 22) + 'px')
        shell.style.setProperty('--line-gap', numberValue(props.lineGap, 28) + 'px')
        shell.style.setProperty('--unit-gap', numberValue(props.unitGap, 4) + 'px')
        shell.style.setProperty('--hanzi', stringValue(props.hanziColor) || '#17324d')
        shell.style.setProperty('--pinyin', stringValue(props.pinyinColor) || '#d94f3d')
        shell.style.setProperty('--surface', stringValue(props.surface) || '#fffdf7')
        shell.style.setProperty('--border', stringValue(props.borderColor) || '#c9d9cd')
        shell.setAttribute('aria-label', stringValue(values.ariaLabel))
        title.hidden = props.showTitle !== true
        title.textContent = stringValue(values.title)
        showAll.textContent = stringValue(values.showAllLabel)
        hideAll.textContent = stringValue(values.hideAllLabel)
        applyPinyinVisibility()

        var lineNodes = parsePairs(stringValue(values.pairs)).map(function (units) {
          var line = document.createElement('div')
          line.className = 'line'
          units.forEach(function (unit, unitIndex) {
            var ruby = document.createElement('ruby')
            var base = document.createElement('rb')
            var reading = document.createElement('rt')
            base.textContent = unit.hanzi
            reading.textContent = unit.pinyin
            var key = unit.hanzi + '|' + unit.pinyin + '|' + unitIndex
            ruby.dataset.unitKey = key
            ruby.tabIndex = props.clickTogglesPinyin === true ? 0 : -1
            ruby.classList.toggle('unit-hidden', locallyHidden.has(key))
            function toggleUnit(event) {
              if (props.clickTogglesPinyin !== true) return
              event.stopPropagation()
              if (locallyHidden.has(key)) locallyHidden.delete(key)
              else locallyHidden.add(key)
              ruby.classList.toggle('unit-hidden', locallyHidden.has(key))
            }
            ruby.addEventListener('click', toggleUnit)
            ruby.addEventListener('keydown', function (event) {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              toggleUnit(event)
            })
            ruby.append(base, reading)
            line.append(ruby)
          })
          return line
        })
        lines.replaceChildren.apply(lines, lineNodes)
      }

      render()
      ctx.capture.waitUntil(document.fonts && document.fonts.ready
        ? document.fonts.ready
        : Promise.resolve())

      return {
        setMode: function () {},
        resize: function () { render() },
        updateProps: function (nextProps) {
          if (nextProps.showPinyin !== props.showPinyin) {
            pinyinVisible = nextProps.showPinyin !== false
          }
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
          eventTarget.removeEventListener('courseware:pinyin-visibility', handleGlobalVisibility)
          root.replaceChildren()
        }
      }
    }
  })
})()
