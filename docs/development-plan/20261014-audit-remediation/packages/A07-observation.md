# A07 观察来源、覆盖与真实操作证据

结果：view.observe回执让使用者知道观察的是现场还是隔离Published，以及能证明什么；普通编辑可用由实际输入证明。

依据F08/T06。Owner：Root现观察装配，与A01/A03就近验收。主要路径：生产observationWorker/现view.observe captureIsolated装配、回执source/identity/coverage/structure/diagnostics、V10现场编辑入口。旧createAuthoringObservationController仅测试构造，不当生产已接；其注册生产引用也不误删。

先使用现有回执字段准确表达隔离载体与状态范围，修任何模糊消费/说明；需要现场属性时接现会话观察，不建验收平台、不要求截图作为每次修改门。运行后果按对应会话或动作序列；导出性能按实际产物。

验证随A03真实窗口或浏览器鼠标/键盘输入、草稿提交与Undo完成；禁止dispatchEvent冒充真实点击。隔离截图只签相应呈现，不能签现场IME、私有运行状态或另一导出路径。已有有效观察不用重跑全部。

