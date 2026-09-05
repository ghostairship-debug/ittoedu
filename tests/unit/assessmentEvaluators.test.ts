import { describe, expect, it } from 'vitest'
import {
  ASSESSMENT_EVALUATOR_REGISTRY,
  evaluateAssessment,
  normalizeNumberAnswer,
  normalizeShortAnswer,
  NUMBER_INPUT_REGEX,
} from '../../src/shared/assessmentEvaluators'

describe('published assessment evaluators', () => {
  it('publishes stable, callable evaluator records', () => {
    expect(ASSESSMENT_EVALUATOR_REGISTRY).toEqual([
      expect.objectContaining({
        id: 'EVAL-finite-choice-v1',
        status: 'stable',
        authorities: ['finite-auto'],
        responseTypes: ['choice'],
      }),
      expect.objectContaining({
        id: 'EVAL-normalized-short-v1',
        status: 'stable',
        authorities: ['normalized-auto'],
        responseTypes: ['normalized-short'],
      }),
    ])
    for (const evaluator of ASSESSMENT_EVALUATOR_REGISTRY) {
      expect(evaluator.invocation).toEqual({
        module: 'src/shared/assessmentEvaluators.ts',
        export: 'evaluateAssessment',
        runtime: 'ctx.assessment.evaluate',
      })
    }
  })

  it('keeps finite choices exact after trimming', () => {
    expect(evaluateAssessment({
      evaluatorId: 'EVAL-finite-choice-v1',
      input: ' A ',
      acceptedValues: ['A'],
    }).status).toBe('pass')
    expect(evaluateAssessment({
      evaluatorId: 'EVAL-finite-choice-v1',
      input: 'a',
      acceptedValues: ['A'],
    }).status).toBe('fail')
  })

  it('normalizes Unicode, case, and whitespace for short answers', () => {
    expect(evaluateAssessment({
      evaluatorId: 'EVAL-normalized-short-v1',
      input: '  Ａ   B  ',
      acceptedValues: ['a b'],
    })).toMatchObject({ normalizedInput: 'a b', status: 'pass' })
  })

  it('binds an invocation to an approved response record when supplied', () => {
    expect(evaluateAssessment({
      responseId: 'RESP-001',
      evaluatorId: 'EVAL-finite-choice-v1',
      input: 'A',
      acceptedValues: ['A'],
    })).toMatchObject({ status: 'pass' })
    expect(() => evaluateAssessment({
      responseId: 'RESP-1',
      evaluatorId: 'EVAL-finite-choice-v1',
      input: 'A',
      acceptedValues: ['A'],
    })).toThrow('responseId')
  })

  it('rejects evaluator IDs that are not in the published registry', () => {
    expect(() => evaluateAssessment({
      evaluatorId: 'EVAL-made-up-v1' as 'EVAL-finite-choice-v1',
      input: 'A',
      acceptedValues: ['A'],
    })).toThrow('未发布的判定器')
  })

  describe('normalizeShortAnswer', () => {
    it('normalizes NFKC, case, and whitespace deterministically', () => {
      expect(normalizeShortAnswer('  Hello   World  ')).toBe('hello world')
      expect(normalizeShortAnswer('Ｈｅｌｌｏ　　Ｗｏｒｌｄ')).toBe('hello world')
      expect(normalizeShortAnswer('Foo\t\nBar')).toBe('foo bar')
      expect(normalizeShortAnswer('   ')).toBe('')
    })
  })

  describe('normalizeNumberAnswer', () => {
    const validCases: Array<[string, number]> = [
      ['0', 0],
      ['123', 123],
      ['-123', -123],
      ['+123', 123],
      ['-45.67', -45.67],
      ['+0.5', 0.5],
      ['.5', 0.5],
      ['5.', 5],
      ['1e5', 100000],
      ['2.5e-3', 0.0025],
      ['+1.2E+4', 12000],
      ['-3.4e-2', -0.034],
      ['１２３', 123],
      ['－４５.６', -45.6],
      ['　789　', 789],
      ['  +0042.50  ', 42.5],
    ]

    for (const [input, expected] of validCases) {
      it(`parses valid input: "${input}" -> ${expected}`, () => {
        expect(normalizeNumberAnswer(input)).toBe(expected)
      })
    }

    const invalidCases: string[] = [
      '',
      '   ',
      '+',
      '-',
      '.',
      '+.',
      '-.',
      '0x10',
      '0b101',
      '0o77',
      '1,000',
      '1_000',
      'NaN',
      'Infinity',
      '-Infinity',
      '+Infinity',
      '1e999999999',
      '1.2.3',
      '12a',
      'a12',
      '12 34',
      '--5',
      '++5',
      '1e',
      '1e+',
    ]

    for (const input of invalidCases) {
      it(`rejects invalid input: "${input}"`, () => {
        expect(normalizeNumberAnswer(input)).toBeNull()
      })
    }

    it('rejects non-string inputs', () => {
      expect(normalizeNumberAnswer(null as unknown as string)).toBeNull()
      expect(normalizeNumberAnswer(undefined as unknown as string)).toBeNull()
      expect(normalizeNumberAnswer(123 as unknown as string)).toBeNull()
      expect(normalizeNumberAnswer({} as unknown as string)).toBeNull()
    })

    it('matches grammar regex specification', () => {
      expect(NUMBER_INPUT_REGEX.test('123')).toBe(true)
      expect(NUMBER_INPUT_REGEX.test('.5')).toBe(true)
      expect(NUMBER_INPUT_REGEX.test('5.')).toBe(true)
      expect(NUMBER_INPUT_REGEX.test('0x10')).toBe(false)
      expect(NUMBER_INPUT_REGEX.test('1,000')).toBe(false)
    })
  })
})

