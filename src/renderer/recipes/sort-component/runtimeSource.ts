export default String.raw`(function () {
  'use strict'
  window.CoursewareComponent.define({
    id: 'com.ittoedu.teaching.sort-order', runtimeApiVersion: 4,
    create: function (ctx) {
      var root = ctx.dom.root, props = ctx.props, mode = ctx.mode, suspended = false, order = [], items = [], expected = [], problem = ''
      function parse() {
        items = String(props.items || '').split('\n').filter(function (line) { return line.trim() }).map(function (line) {
          var parts = line.split('|'); return { id: parts[0].trim(), text: (parts[1] || '').trim() }
        })
        expected = String(props.correctOrder || '').split(',').map(function (id) { return id.trim() })
        var ids = items.map(function (item) { return item.id })
        problem = items.length < 2 || items.some(function (item) { return !item.id || !item.text }) || new Set(ids).size !== ids.length || expected.length !== ids.length || new Set(expected).size !== ids.length || expected.some(function (id) { return ids.indexOf(id) < 0 }) ? '配置无效：项目 ID 必须唯一，正确顺序必须恰好包含全部项目。' : ''
        order = ids.slice()
      }
      function make(tag, text) { var el = document.createElement(tag); if (text) el.textContent = text; return el }
      function render(message, focusId, direction) {
        root.replaceChildren()
        var style = make('style'); style.textContent = ':host{display:block;width:100%;height:100%}.sort{box-sizing:border-box;height:100%;overflow:auto;padding:20px;background:#f1f5f9;border-radius:16px;font:22px Microsoft YaHei,sans-serif;color:#172554}.row{display:flex;align-items:center;gap:12px;padding:8px;border-bottom:1px solid #cbd5e1}.label{flex:1}button{font:inherit;border:1px solid #94a3b8;background:white;border-radius:6px;padding:5px 12px;margin:4px;cursor:pointer}button:focus-visible{outline:3px solid #2563eb}.status{min-height:32px;margin-top:12px}'
        var shell = make('div'); shell.className = 'sort'
        var enabled = mode === 'preview' && !suspended && !problem
        order.forEach(function (id, index) {
          var item = items.find(function (candidate) { return candidate.id === id }), row = make('div'), label = make('span', (index + 1) + '. ' + item.text)
          row.className = 'row'; label.className = 'label'; row.append(label)
          ;[-1, 1].forEach(function (delta) {
            var button = make('button', delta < 0 ? '上移' : '下移'); button.type = 'button'; button.setAttribute('aria-label', item.text + (delta < 0 ? '上移' : '下移'))
            button.disabled = !enabled || index + delta < 0 || index + delta >= order.length
            button.addEventListener('click', function () { var other = order[index + delta]; order[index + delta] = id; order[index] = other; render('', id, delta) })
            row.append(button)
            if (focusId === id && direction === delta) queueMicrotask(function () { if (!button.disabled) button.focus(); else row.querySelector('button:not(:disabled)')?.focus() })
          }); shell.append(row)
        })
        var check = make('button', '检查答案'), reset = make('button', '重置'); check.type = reset.type = 'button'; check.disabled = reset.disabled = !enabled
        check.addEventListener('click', function () { var correct = order.every(function (id, index) { return id === expected[index] }); render(String((props.content || {})[correct ? 'success' : 'failure'] || (correct ? '正确' : '请再试一次'))); ctx.emit('answer', { correct: correct }) })
        reset.addEventListener('click', function () { parse(); render('已重置') })
        var status = make('div', problem || message || '用上移、下移按钮调整顺序，然后检查答案。'); status.className = 'status'; status.setAttribute('role', 'status')
        shell.append(check, reset, status); root.append(style, shell)
      }
      parse(); render()
      return {
        setMode: function (next) { mode = next; parse(); render() },
        updateProps: function (next) { props = next; parse(); render() }, resize: function () {},
        setVisible: function (visible) { root.style.display = visible ? '' : 'none' },
        suspend: function () { suspended = true; render() }, resume: function () { suspended = false; render() },
        prepareCapture: function () { parse(); render() }, destroy: function () { root.replaceChildren() },
      }
    },
  })
})()
`
