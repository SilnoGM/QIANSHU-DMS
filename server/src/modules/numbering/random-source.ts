import { randomInt } from 'node:crypto'

import type { NumberingRandomSegment } from './rule-types'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'

/**
 * 规则引擎只依赖“有界整数”这一窄接口。生产适配器使用 node:crypto；测试
 * 和无状态预览可以注入确定性实现，核心源码不依赖通用伪随机 API。
 */
export interface NumberingRandomSource {
  nextInt(maxExclusive: number): number
}

/** 生产窄适配器保持无状态，可安全由管理 preview 与正式发号路径复用。 */
export class CryptoNumberingRandomSource implements NumberingRandomSource {
  nextInt(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1) {
      throw new RangeError('随机上界必须是正安全整数')
    }

    return randomInt(maxExclusive)
  }
}

export const cryptoNumberingRandomSource: NumberingRandomSource =
  new CryptoNumberingRandomSource()

function assertRandomSegment(segment: NumberingRandomSegment): void {
  const totalLength = segment.letterLength + segment.digitLength

  if (
    !Number.isInteger(segment.letterLength)
    || segment.letterLength < 0
    || segment.letterLength > 32
    || !Number.isInteger(segment.digitLength)
    || segment.digitLength < 0
    || segment.digitLength > 32
    || totalLength < 1
    || totalLength > 32
    || !['LETTERS_THEN_DIGITS', 'SHUFFLED'].includes(segment.mode)
  ) {
    throw new RangeError('随机片段配置不合法')
  }
}

function takeCharacter(
  alphabet: string,
  source: NumberingRandomSource,
): string {
  const index = source.nextInt(alphabet.length)

  if (!Number.isInteger(index) || index < 0 || index >= alphabet.length) {
    throw new RangeError('随机源返回了越界整数')
  }

  return alphabet[index]
}

export function renderRandomSegment(
  segment: NumberingRandomSegment,
  source: NumberingRandomSource,
): string {
  assertRandomSegment(segment)

  const characters = [
    ...Array.from(
      { length: segment.letterLength },
      () => takeCharacter(LETTERS, source),
    ),
    ...Array.from(
      { length: segment.digitLength },
      () => takeCharacter(DIGITS, source),
    ),
  ]

  if (segment.mode === 'LETTERS_THEN_DIGITS') {
    return characters.join('')
  }

  // Fisher-Yates 只决定位置，不改变已经生成的字母和数字精确数量。
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const replacementIndex = source.nextInt(index + 1)

    if (
      !Number.isInteger(replacementIndex)
      || replacementIndex < 0
      || replacementIndex > index
    ) {
      throw new RangeError('随机源返回了越界整数')
    }

    const current = characters[index]
    characters[index] = characters[replacementIndex]
    characters[replacementIndex] = current
  }

  return characters.join('')
}
