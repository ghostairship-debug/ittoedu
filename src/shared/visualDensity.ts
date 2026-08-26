import { rotatedRectangleAabb } from './geometry'
import { ensureScenePresentation, materializeScene } from './presentation'
import type { ProjectDocument, SceneNode } from './projectTypes'

export type VisualDensityBand = 'light' | 'balanced' | 'dense'

export interface VisualDensityStateReport {
  sceneId: string
  sceneName: string
  stateId: string
  stateName: string
  visibleNodeCount: number
  textCharacterCount: number
  occupiedAreaRatio: number
  significantOverlapPairs: number
  score: number
  band: VisualDensityBand
}

export interface VisualDensityReport {
  states: VisualDensityStateReport[]
  summary: {
    maximumScore: number
    denseStateCount: number
  }
}

interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface AnalyzeVisualDensityStateInput {
  sceneId: string
  sceneName: string
  stateId: string
  stateName: string
  nodes: readonly SceneNode[]
  canvas: {
    width: number
    height: number
  }
}

function visibleGlobalNodes(project: ProjectDocument, sceneId: string): SceneNode[] {
  return project.globalLayer
    .filter(({ visibility }) => {
      if (visibility.mode === 'all') return true
      const listed = visibility.sceneIds.includes(sceneId)
      return visibility.mode === 'include' ? listed : !listed
    })
    .map(({ node }) => node)
    .filter((node) => node.visible && node.type !== 'teacher-controller')
}

function clippedArea(bounds: Bounds, width: number, height: number): number {
  const left = Math.max(0, bounds.left)
  const top = Math.max(0, bounds.top)
  const right = Math.min(width, bounds.right)
  const bottom = Math.min(height, bounds.bottom)
  return Math.max(0, right - left) * Math.max(0, bottom - top)
}

function overlapArea(left: Bounds, right: Bounds): number {
  return Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left)) *
    Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top))
}

function visibleTextLength(node: SceneNode): number {
  if (node.type === 'text') return Array.from(node.text.trim()).length
  if (node.type === 'formula') return Array.from(node.accessibleText.trim()).length
  return 0
}

function scoreBand(score: number): VisualDensityBand {
  if (score >= 70) return 'dense'
  if (score >= 38) return 'balanced'
  return 'light'
}

/**
 * Shape-neutral density primitive for one already-composed Slide state.
 * Membership, overrides, visibility and order must be resolved by the caller.
 */
export function analyzeVisualDensityState(
  input: AnalyzeVisualDensityStateInput,
): VisualDensityStateReport {
  const nodes = input.nodes.filter(
    (node) => node.visible && node.type !== 'teacher-controller',
  )
  const bounds = nodes.map((node) => rotatedRectangleAabb(node))
  const canvasArea = input.canvas.width * input.canvas.height
  const summedArea = bounds.reduce(
    (total, item) => total + clippedArea(item, input.canvas.width, input.canvas.height),
    0,
  )
  let significantOverlapPairs = 0
  for (let leftIndex = 0; leftIndex < bounds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < bounds.length; rightIndex += 1) {
      const left = bounds[leftIndex]!
      const right = bounds[rightIndex]!
      const overlap = overlapArea(left, right)
      const smallerArea = Math.min(
        clippedArea(left, input.canvas.width, input.canvas.height),
        clippedArea(right, input.canvas.width, input.canvas.height),
      )
      if (smallerArea > 0 && overlap / smallerArea >= 0.25) {
        significantOverlapPairs += 1
      }
    }
  }
  const textCharacterCount = nodes.reduce(
    (total, node) => total + visibleTextLength(node),
    0,
  )
  const occupiedAreaRatio = Math.min(2, summedArea / Math.max(1, canvasArea))
  const score = Math.round(Math.min(100,
    Math.min(1, nodes.length / 24) * 30 +
    Math.min(1, textCharacterCount / 500) * 25 +
    Math.min(1, occupiedAreaRatio / 0.9) * 25 +
    Math.min(1, significantOverlapPairs / 12) * 20,
  ))
  return {
    sceneId: input.sceneId,
    sceneName: input.sceneName,
    stateId: input.stateId,
    stateName: input.stateName,
    visibleNodeCount: nodes.length,
    textCharacterCount,
    occupiedAreaRatio,
    significantOverlapPairs,
    score,
    band: scoreBand(score),
  }
}

/**
 * A deterministic, read-only overview. The score is a review aid rather than
 * a correctness verdict: it combines object count, visible copy, occupied
 * area and substantial AABB overlaps without interpreting visual meaning.
 */
export function analyzeVisualDensity(project: ProjectDocument): VisualDensityReport {
  const states = project.scenes.flatMap((scene) => {
    const presentation = ensureScenePresentation(scene)
    const globalNodes = visibleGlobalNodes(project, scene.id)
    return presentation.states.map((state): VisualDensityStateReport => {
      const effective = materializeScene(scene, state.id)
      return analyzeVisualDensityState({
        sceneId: scene.id,
        sceneName: scene.name,
        stateId: state.id,
        stateName: state.name,
        nodes: [...effective.nodes, ...globalNodes],
        canvas: project.canvas,
      })
    })
  })
  return {
    states,
    summary: {
      maximumScore: Math.max(0, ...states.map(({ score }) => score)),
      denseStateCount: states.filter(({ band }) => band === 'dense').length,
    },
  }
}
