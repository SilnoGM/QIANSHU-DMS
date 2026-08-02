import { NumberingRuleConfigError } from './rule-engine'
import {
  calculateNumberingConfigFingerprint,
  prepareNumberingRuleConfig,
  serializeCanonicalNumberingRuleConfig,
} from './numbering-config-fingerprint'

const CONFIG = {
  resetPolicy: 'DAILY',
  segments: [
    { type: 'FIXED', value: 'SO' },
    { type: 'DATE', format: 'YYYYMMDD' },
    { type: 'SEPARATOR', value: '-' },
    { type: 'SEQUENCE', width: 6, startValue: '1', step: '1' },
    {
      type: 'RANDOM',
      letterLength: 2,
      digitLength: 2,
      mode: 'SHUFFLED',
    },
  ],
} as const

describe('numbering config fingerprint', () => {
  it('freezes the canonical UTF-8 JSON and lowercase SHA-256 digest', () => {
    const canonical = serializeCanonicalNumberingRuleConfig(CONFIG)

    expect(canonical).toBe(
      '{"resetPolicy":"DAILY","timezone":"Asia/Shanghai",'
      + '"segments":[{"type":"FIXED","value":"SO"},'
      + '{"type":"DATE","format":"YYYYMMDD"},'
      + '{"type":"SEPARATOR","value":"-"},'
      + '{"type":"SEQUENCE","width":6,"startValue":"1","step":"1"},'
      + '{"type":"RANDOM","letterLength":2,"digitLength":2,'
      + '"mode":"SHUFFLED"}]}',
    )
    expect(calculateNumberingConfigFingerprint(CONFIG)).toBe(
      'ffdcb8d3863a3de16f008d99d00c1f7801b72c369ada3cd1db3ee849e1af55d1',
    )
  })

  it('rebuilds every object with fixed key order before hashing', () => {
    const reordered = {
      segments: [
        { value: 'SO', type: 'FIXED' },
        { format: 'YYYYMMDD', type: 'DATE' },
        { value: '-', type: 'SEPARATOR' },
        { step: '1', startValue: '1', width: 6, type: 'SEQUENCE' },
        {
          mode: 'SHUFFLED',
          digitLength: 2,
          letterLength: 2,
          type: 'RANDOM',
        },
      ],
      resetPolicy: 'DAILY',
    }

    expect(calculateNumberingConfigFingerprint(reordered))
      .toBe(calculateNumberingConfigFingerprint(CONFIG))
    expect(prepareNumberingRuleConfig(reordered).config)
      .toEqual(CONFIG)
  })

  it('preserves segment order and rejects unknown fields before hashing', () => {
    const reorderedSegments = {
      ...CONFIG,
      segments: [CONFIG.segments[1], CONFIG.segments[0], ...CONFIG.segments.slice(2)],
    }
    const withSecret = {
      ...CONFIG,
      secret: 'must-not-enter-fingerprint',
    }

    expect(calculateNumberingConfigFingerprint(reorderedSegments))
      .not.toBe(calculateNumberingConfigFingerprint(CONFIG))
    expect(() => calculateNumberingConfigFingerprint(withSecret))
      .toThrow(NumberingRuleConfigError)
  })
})
