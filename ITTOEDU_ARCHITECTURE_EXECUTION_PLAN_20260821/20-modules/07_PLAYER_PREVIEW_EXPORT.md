# Player、试运行、整课预览与导出

---

## 1. 唯一生产链

```text
CourseProjectDocument + sidecars
→ Published Course V2 producer
→ CoursePlayer
→ 当前位置试运行 / 整课预览
→ HTML / Web Package

同一文档
→ Print/Static plan
→ PPTX / PDF / DOCX
```

不同产物可以有不同 adapter，但不能各自重新解释作者数据。

---

## 2. Player 边界

Player：

- 只读；
- 维护会话状态；
- 可执行互动；
- 可移动运行态相机/控制器；
- destroy 时释放 Host；
- 不写作者 document；
- 不直接导入 renderer store。

---

## 3. 试运行

输入应明确：

```ts
{
  documentRevision,
  startLocationId,
  publishedPayload,
  assets,
  componentPackages
}
```

退出后恢复：

- 原 Surface；
- location；
- selection；
- viewport（可行时）。

试运行期间用户动作只改变 Player session。

---

## 4. 整课预览

与当前位置试运行复用：

- Published producer；
- CoursePlayer；
- Host；
- asset/component bytes。

只在起始 location、窗口布局和导航范围上不同。

---

## 5. Mount 生命周期

当前复杂性应通过一个轻量 mount helper 收口：

```text
generation
mount
ready
destroy
```

要求：

- 新 generation 使旧结果失效；
- React 重渲染不重复创建活 Host；
- destroy 幂等；
- mount 失败显示局部错误；
- 失败不改变作者 document。

不引入通用状态机库。

---

## 6. 导出

### HTML/网页包

使用 Published Course V2，保留互动。

### PPTX/PDF

使用同一作者 document 的静态/捕获计划：

- Native 尽量原生；
- Component/Runtime 使用快照或 fallback；
- 教师控制器按产品规则省略或静态化；
- warning 不应与 hard error 混淆。

### DOCX

仅对 Flow 内容可用，但应读取同一 Flow model，不维护第二份讲义数据。

---

## 7. 预检

导出预检只在：

- 用户开始导出；
- 专业模式主动查看；
- 最终验证。

不应在每次编辑时计算所有导出目标。

---

## 8. 完成标准

- Preview 与 Export 读取 canonical document；
- Player 不写 Store；
- 试运行和整课预览共用 producer；
- mount/destroy 可测试；
- 各导出目标无重复业务解释；
- Surface 迁移不需要修改 Player 核心。
