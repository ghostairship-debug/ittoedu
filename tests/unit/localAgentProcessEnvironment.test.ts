import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { agentEnvironment } from '../../src/main/localAgent/process'

describe('native candidate environment anchor', () => {
  it('replaces inherited anchors without mutating native authentication proxy or tool settings', () => {
    const source = Object.freeze({
      COURSEWARE_CANDIDATE_ROOT: 'stale-upper', courseware_candidate_root: 'stale-lower',
      ELECTRON_RUN_AS_NODE: '1', Electron_No_Attach_Console: '1', ELECTRON_ENABLE_LOGGING: '1',
      PATH: 'native-tools', HTTP_PROXY: 'native-proxy', ANTHROPIC_API_KEY: 'fixture-auth',
      CODEX_HOME: 'native-config', CUSTOM_TOOL_HOME: 'native-connection',
    })
    const candidateRoot = path.resolve('候选 A with spaces')
    const environment = agentEnvironment(source, candidateRoot)
    expect(environment).toEqual({
      COURSEWARE_CANDIDATE_ROOT: candidateRoot, PATH: 'native-tools', HTTP_PROXY: 'native-proxy',
      ANTHROPIC_API_KEY: 'fixture-auth', CODEX_HOME: 'native-config', CUSTOM_TOOL_HOME: 'native-connection',
    })
    expect(source.COURSEWARE_CANDIDATE_ROOT).toBe('stale-upper')
    expect(source.courseware_candidate_root).toBe('stale-lower')
    expect(source.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('clears an inherited candidate anchor when the next launch has none', () => {
    const source = { COURSEWARE_CANDIDATE_ROOT: path.resolve('old'), courseware_candidate_root: 'old-lower', PATH: 'native-tools' }
    expect(agentEnvironment(source)).toEqual({ PATH: 'native-tools' })
    expect(source.COURSEWARE_CANDIDATE_ROOT).toBe(path.resolve('old'))
  })

  it('rejects a relative candidate anchor instead of changing the native working directory', () => {
    expect(() => agentEnvironment({ PATH: 'native-tools' }, 'relative/candidate')).toThrow('绝对路径')
  })
})
