# 仅查询当前任务所需能力

当前工具清单给出真正可调用的能力。普通 HTML 新建课件使用 `course.createFromHtml`；局部修订以当前内容与实际编辑入口为依据。软件的内部工厂、历史工具名或计划文件不等于当前可调用接口。

用户明确使用外部 Builder V2 时，`session.discover()` / `api.discover()` 和 `readCapability()` 提供该执行环境实际支持的能力，详见 [外部构建](external-case-build.md)。只读取所需内容的合同，不把整个索引加入创作上下文。

正文、图表、图片、程序组件有不同的可编辑边界；需要判断时读取 [承载方式](representation-capabilities.md)。对于具体不支持的内容，说明实际缺口并保留来源，不根据空目录或某个分组的查询结果推断软件完全没有相关能力。
