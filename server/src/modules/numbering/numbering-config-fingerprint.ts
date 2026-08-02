import { createHash } from 'node:crypto'

import {
  type NumberingRuleConfig,
  type NumberingRuleSegment,
  validateNumberingRuleConfig,
} from './rule-engine'

export const NUMBERING_CONFIG_TIMEZONE = 'Asia/Shanghai' as const

export interface PreparedNumberingRuleConfig {
  readonly config: NumberingRuleConfig
  readonly configFingerprint: string
}

function rebuildSegment(segment: NumberingRuleSegment): NumberingRuleSegment {
  switch (segment.type) {
    case 'FIXED':
      return { type: 'FIXED', value: segment.value }
    case 'DATE':
      return { type: 'DATE', format: segment.format }
    case 'SEPARATOR':
      return { type: 'SEPARATOR', value: segment.value }
    case 'SEQUENCE':
      return {
        type: 'SEQUENCE',
        width: segment.width,
        startValue: segment.startValue,
        step: segment.step,
      }
    case 'RANDOM':
      return {
        type: 'RANDOM',
        letterLength: segment.letterLength,
        digitLength: segment.digitLength,
        mode: segment.mode,
      }
  }
}

function serializeValidatedConfig(config: NumberingRuleConfig): string {
  return JSON.stringify({
    resetPolicy: config.resetPolicy,
    timezone: NUMBERING_CONFIG_TIMEZONE,
    segments: config.segments.map(rebuildSegment),
  })
}

/**
 * Fingerprint 的字节合同必须跨进程稳定：领域校验先重建精确联合类型，然后用固定
 * top-level/segment 键序 JSON 化。未知字段不会静默进入持久化 Hash。
 */
export function serializeCanonicalNumberingRuleConfig(input: unknown): string {
  return serializeValidatedConfig(validateNumberingRuleConfig(input))
}

export function calculateNumberingConfigFingerprint(input: unknown): string {
  const canonical = serializeCanonicalNumberingRuleConfig(input)
  return createHash('sha256')
    .update(Buffer.from(canonical, 'utf8'))
    .digest('hex')
}

export function prepareNumberingRuleConfig(
  input: unknown,
): PreparedNumberingRuleConfig {
  const config = validateNumberingRuleConfig(input)
  const canonical = serializeValidatedConfig(config)

  return {
    config,
    configFingerprint: createHash('sha256')
      .update(Buffer.from(canonical, 'utf8'))
      .digest('hex'),
  }
}
