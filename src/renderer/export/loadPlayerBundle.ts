/// <reference path="../virtual-player-bundle.d.ts" />
import playerBundle from 'virtual:player-bundle'

export function loadPlayerBundle(): string {
  if (!playerBundle.trim()) {
    throw new Error('Player Runtime 构建产物为空')
  }
  return playerBundle
}
