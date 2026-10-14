/// <reference path="../virtual-compiled-player-bundle.d.ts" />
import bundle from 'virtual:compiled-player-bundle'
export function loadCompiledPlayerBundle():string {if(!bundle.trim())throw new Error('编译播放运行包构建产物为空');return bundle}
