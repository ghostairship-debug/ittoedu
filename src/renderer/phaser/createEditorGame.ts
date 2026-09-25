import * as Phaser from 'phaser'
import { DEFAULT_SLIDE_CANVAS, type SlideCanvasSize } from '../../shared/slideCanvas'
import { EditorPhaserBridge } from './EditorPhaserBridge'
import { EditorScene } from './EditorScene'

export interface EditorGameHandle {
  game: Phaser.Game
  bridge: EditorPhaserBridge
  destroy(): void
}

export interface CreateEditorGameOptions {
  /** The unified stage owns fitting, so Phaser must not measure it. */
  fixedLogicalSize?: boolean
  /** Current Slide canvas. Defaults to the legacy 1280×720. */
  stage?: SlideCanvasSize
}

export function createEditorGame(
  parent: HTMLElement,
  options: CreateEditorGameOptions = {},
): EditorGameHandle {
  const bridge = new EditorPhaserBridge()
  const stage = options.stage ?? DEFAULT_SLIDE_CANVAS
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: stage.width,
    height: stage.height,
    parent,
    backgroundColor: 'rgba(0,0,0,0)',
    transparent: true,
    scale: {
      mode: options.fixedLogicalSize ? Phaser.Scale.NONE : Phaser.Scale.FIT,
      autoCenter: options.fixedLogicalSize
        ? Phaser.Scale.NO_CENTER
        : Phaser.Scale.CENTER_BOTH,
      width: stage.width,
      height: stage.height,
    },
    scene: [new EditorScene(bridge, stage)],
    input: {
      activePointers: 2,
    },
    render: {
      antialias: true,
      pixelArt: false,
      roundPixels: false,
    },
    banner: false,
  })

  return {
    game,
    bridge,
    destroy() {
      bridge.dispose()
      game.destroy(true)
    },
  }
}
