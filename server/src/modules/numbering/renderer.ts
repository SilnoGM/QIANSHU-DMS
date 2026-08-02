import { formatSequenceValue } from './capacity'
import { renderNumberingDate } from './period'
import {
  type NumberingRandomSource,
  renderRandomSegment,
} from './random-source'
import {
  type NumberingRuleConfig,
  NumberingRuleConfigError,
} from './rule-types'

/**
 * 渲染器只消费已经校验的配置、显式数据库时间和显式序列值；它本身不读取
 * 系统时钟，也不读取或推进 period state。
 */
export function renderNumberingCandidate(
  config: NumberingRuleConfig,
  databaseTime: Date,
  sequenceValue: bigint | null,
  randomSource: NumberingRandomSource | undefined,
): string {
  const output = config.segments.map((segment) => {
    switch (segment.type) {
      case 'FIXED':
        return segment.value
      case 'DATE':
        return renderNumberingDate(segment.format, databaseTime)
      case 'SEPARATOR':
        return segment.value
      case 'SEQUENCE':
        if (sequenceValue === null) {
          throw new RangeError('渲染序列规则时必须提供序列值')
        }

        return formatSequenceValue(segment, sequenceValue)
      case 'RANDOM':
        if (randomSource === undefined) {
          throw new RangeError('渲染随机规则时必须提供随机源')
        }

        return renderRandomSegment(segment, randomSource)
    }
  }).join('')

  // 最终保护与数据库 CHECK 使用同一冻结字母表，阻断损坏的持久化快照。
  if (!/^[A-Z0-9_./-]{1,64}$/u.test(output)) {
    throw new NumberingRuleConfigError([
      { path: 'segments', message: '渲染结果不符合冻结编号字母表' },
    ])
  }

  return output
}
