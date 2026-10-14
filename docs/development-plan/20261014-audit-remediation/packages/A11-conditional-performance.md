# A11 剩余性能条件项

这是可执行调查/修复条件包，不是确认缺陷，也不自动进入active。

触发：A06后用户对应动作仍明显慢，且新trace能够改变实现决定。Owner：Root对应原owner；取真实浏览器导出、编辑或模型请求之一，不混路径。

候选路径：ComponentRuntimeWorld的全targets构造、每listener clone、project引用变化后的全量layout通知与实例同步；InMemoryComponentCompilation在durationMs计时外的snapshot/JSON/hash及实际IPC/挂载；open→attach重复快照、编译/投影缓存。先取一次最窄profile，确认占比和频次再只改所证owner。

排除错误前提：资产prepareResources已有MIME/source identity复用；Published Web/static视图已有签名去重；Source有离屏lazy skip。不能称每sync重建全部资产、每状态全量重编。旧《天下拼图》resize/visibility/directory已有相关修复，不再重复派发。

验法：同作品同环境同用户动作前后对照，并核该变化触及的身份/状态/资源保留行为；不预设70%等倍率，不建总缓存/调度/虚拟化平台。无新证据则写“未触发，不需当前实施”，停止调查，不为覆盖报告而制造改动。

