import { renderNumberingCandidate } from './renderer'
import {
  type NumberingRuleConfig,
  NumberingRuleConfigError,
} from './rule-types'

const DATABASE_TIME = new Date('2026-07-28T16:00:00.000Z')

describe('numbering renderer runtime guard', () => {
  it.each([':', '@'])(
    'rejects a damaged snapshot containing %s outside the frozen alphabet',
    (invalidCharacter) => {
      // 模拟绕过正常配置校验的损坏持久化快照，验证渲染边界仍会 fail closed。
      const damagedConfig = {
        resetPolicy: 'NEVER',
        segments: [
          { type: 'FIXED', value: invalidCharacter },
          {
            type: 'SEQUENCE',
            width: 1,
            startValue: '0',
            step: '1',
          },
        ],
      } as NumberingRuleConfig

      expect(() => renderNumberingCandidate(
        damagedConfig,
        DATABASE_TIME,
        0n,
        undefined,
      )).toThrow(NumberingRuleConfigError)
    },
  )
})
