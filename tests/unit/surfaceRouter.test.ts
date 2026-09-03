import { describe, expect, it } from 'vitest'
import {
  detectActiveSurface,
  dispatchActiveSurface,
  exclusiveInactiveSurfaces,
} from '../../src/renderer/composition/surfaceRouter'

describe('surfaceRouter', () => {
  describe('detectActiveSurface', () => {
    it('detects spatial surface when spatialLocationId is set', () => {
      const surface = detectActiveSurface({
        spatialLocationId: 'loc-spatial',
        flowLocationId: null,
        slideLocationId: null,
        editingScope: 'scene',
        composing: false,
      })
      expect(surface).toBe('spatial')
    })

    it('detects flow surface when flowLocationId is set', () => {
      const surface = detectActiveSurface({
        spatialLocationId: null,
        flowLocationId: 'loc-flow',
        slideLocationId: null,
        editingScope: 'scene',
        composing: false,
      })
      expect(surface).toBe('flow')
    })

    it('detects slide surface when slideLocationId is set', () => {
      const surface = detectActiveSurface({
        spatialLocationId: null,
        flowLocationId: null,
        slideLocationId: 'loc-slide',
        editingScope: 'scene',
        composing: false,
      })
      expect(surface).toBe('slide')
    })

    it('returns null when no location is active', () => {
      const surface = detectActiveSurface({
        spatialLocationId: null,
        flowLocationId: null,
        slideLocationId: null,
        editingScope: 'scene',
        composing: false,
      })
      expect(surface).toBeNull()
    })
  })

  describe('dispatchActiveSurface', () => {
    it('dispatches to matching surface handler', () => {
      const handlers = {
        slide: () => 'slide-ran',
        flow: () => 'flow-ran',
        spatial: () => 'spatial-ran',
        none: () => 'none-ran',
      }

      expect(dispatchActiveSurface('slide', handlers)).toBe('slide-ran')
      expect(dispatchActiveSurface('flow', handlers)).toBe('flow-ran')
      expect(dispatchActiveSurface('spatial', handlers)).toBe('spatial-ran')
      expect(dispatchActiveSurface(null, handlers)).toBe('none-ran')
    })

    it('supports sessionless handler fallback when null', () => {
      const handlers = {
        slide: () => 'slide-ran',
        flow: () => 'flow-ran',
        spatial: () => 'spatial-ran',
        sessionless: () => 'sessionless-ran',
      }
      expect(dispatchActiveSurface(null, handlers)).toBe('sessionless-ran')
    })
  })

  describe('exclusiveInactiveSurfaces', () => {
    it('clears inactive surfaces based on active kind', () => {
      const clearForSlide = exclusiveInactiveSurfaces('slide')
      expect(clearForSlide.flowSession).toBeNull()
      expect(clearForSlide.spatialSession).toBeNull()

      const clearForFlow = exclusiveInactiveSurfaces('flow')
      expect(clearForFlow.slideBackend).toBeNull()
      expect(clearForFlow.spatialSession).toBeNull()

      const clearForSpatial = exclusiveInactiveSurfaces('spatial')
      expect(clearForSpatial.slideBackend).toBeNull()
      expect(clearForSpatial.flowSession).toBeNull()
    })
  })
})
