import { validateNumberingRuleConfig } from './rule-validation'
import {
  type NumberingRuleConfig,
  NumberingRuleConfigError,
  type NumberingRuleConfigIssue,
} from './rule-types'

function addFrozenFieldIssue(
  issues: NumberingRuleConfigIssue[],
  path: string,
): void {
  // 错误只描述冻结规则与字段位置，不拼接配置值，避免把业务编号片段带入异常。
  issues.push({ path, message: '首次发号后不允许修改该字段' })
}

/**
 * 校验已成功发号规则的新配置是否仍位于同一编号空间。两端都会先经过领域
 * validator 并被重建，因此未知字段 fail closed；比较过程只读取快照，不修改
 * 调用方对象。首期唯一允许的结构变化是扩大 SEQUENCE width。
 */
export function validateIssuedRuleConfigCompatibility(
  previousInput: unknown,
  nextInput: unknown,
): NumberingRuleConfig {
  const previous = validateNumberingRuleConfig(previousInput)
  const next = validateNumberingRuleConfig(nextInput)
  const issues: NumberingRuleConfigIssue[] = []

  if (previous.resetPolicy !== next.resetPolicy) {
    addFrozenFieldIssue(issues, 'resetPolicy')
  }

  if (previous.segments.length !== next.segments.length) {
    addFrozenFieldIssue(issues, 'segments')
  }

  const comparableLength = Math.min(
    previous.segments.length,
    next.segments.length,
  )

  for (let index = 0; index < comparableLength; index += 1) {
    const previousSegment = previous.segments[index]
    const nextSegment = next.segments[index]
    const basePath = `segments[${index}]`

    if (previousSegment.type !== nextSegment.type) {
      addFrozenFieldIssue(issues, `${basePath}.type`)
      continue
    }

    switch (previousSegment.type) {
      case 'FIXED':
        if (
          nextSegment.type === 'FIXED'
          && previousSegment.value !== nextSegment.value
        ) {
          addFrozenFieldIssue(issues, `${basePath}.value`)
        }
        break

      case 'DATE':
        if (
          nextSegment.type === 'DATE'
          && previousSegment.format !== nextSegment.format
        ) {
          addFrozenFieldIssue(issues, `${basePath}.format`)
        }
        break

      case 'SEPARATOR':
        if (
          nextSegment.type === 'SEPARATOR'
          && previousSegment.value !== nextSegment.value
        ) {
          addFrozenFieldIssue(issues, `${basePath}.value`)
        }
        break

      case 'SEQUENCE':
        if (nextSegment.type !== 'SEQUENCE') {
          break
        }

        if (previousSegment.startValue !== nextSegment.startValue) {
          addFrozenFieldIssue(issues, `${basePath}.startValue`)
        }
        if (previousSegment.step !== nextSegment.step) {
          addFrozenFieldIssue(issues, `${basePath}.step`)
        }
        if (nextSegment.width < previousSegment.width) {
          issues.push({
            path: `${basePath}.width`,
            message: '首次发号后序列宽度只能保持或扩大',
          })
        }
        break

      case 'RANDOM':
        if (nextSegment.type !== 'RANDOM') {
          break
        }

        if (previousSegment.letterLength !== nextSegment.letterLength) {
          addFrozenFieldIssue(issues, `${basePath}.letterLength`)
        }
        if (previousSegment.digitLength !== nextSegment.digitLength) {
          addFrozenFieldIssue(issues, `${basePath}.digitLength`)
        }
        if (previousSegment.mode !== nextSegment.mode) {
          addFrozenFieldIssue(issues, `${basePath}.mode`)
        }
        break
    }
  }

  if (issues.length > 0) {
    throw new NumberingRuleConfigError(issues)
  }

  return next
}
