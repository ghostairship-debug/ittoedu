import { createComponentInteractionRuntime } from '../../renderer/interactions/componentInteractionRuntime'

export default createComponentInteractionRuntime(context => {
  if (!context.interactions) throw new Error('互动源码需要文档互动端口')
  return context.interactions
})
