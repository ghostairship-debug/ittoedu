export interface TeacherControllerSessionOffset {
  dx: number
  dy: number
}

export interface TeacherControllerLogicalSize {
  width: number
  height: number
}

export interface TeacherControllerRuntimeSessionValue {
  offset: TeacherControllerSessionOffset
  collapsed: boolean
}

export interface TeacherControllerRuntimeSessionAddress {
  controllerId: string
  surfaceSessionId: string
  defaultCollapsed: boolean
}

/**
 * Runtime-only controller state. Collapse follows a stable controller across
 * the course, while offsets remain owned by the surface session that moved it.
 */
export class TeacherControllerRuntimeSessionStore {
  readonly #collapsedByControllerId = new Map<string, boolean>()
  readonly #offsetBySurfaceSession = new Map<string, Map<string, TeacherControllerSessionOffset>>()

  get(address: TeacherControllerRuntimeSessionAddress): TeacherControllerRuntimeSessionValue {
    const surfaceOffsets = this.#offsetBySurfaceSession.get(address.surfaceSessionId)
    const offset = surfaceOffsets?.get(address.controllerId) ?? { dx: 0, dy: 0 }
    return {
      offset: { ...offset },
      collapsed: this.#collapsedByControllerId.get(address.controllerId)
        ?? address.defaultCollapsed,
    }
  }

  set(
    address: TeacherControllerRuntimeSessionAddress,
    value: TeacherControllerRuntimeSessionValue,
  ): void {
    this.#collapsedByControllerId.set(address.controllerId, value.collapsed)
    let surfaceOffsets = this.#offsetBySurfaceSession.get(address.surfaceSessionId)
    if (!surfaceOffsets) {
      surfaceOffsets = new Map()
      this.#offsetBySurfaceSession.set(address.surfaceSessionId, surfaceOffsets)
    }
    surfaceOffsets.set(address.controllerId, { ...value.offset })
  }

  resetSurface(surfaceSessionId: string): void {
    this.#offsetBySurfaceSession.delete(surfaceSessionId)
  }

  resetCourse(): void {
    this.#collapsedByControllerId.clear()
    this.#offsetBySurfaceSession.clear()
  }
}

/** Geometry in surface coordinates; visuals and hit regions are owned by the component. */
export interface TeacherControllerRuntimeNode { x: number; y: number; width: number; height: number; rotation: number; flowViewport?: boolean; playbackView?: boolean }
