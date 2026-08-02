import type { NumberingRandomSegment } from './rule-types'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'

/**
 * 规则引擎只依赖“有界整数”这一窄接口。生产适配器将在发号任务中接入
 * node:crypto；测试和无状态预览可以注入确定性实现，且核心源码无需接触
 * Math.random()。
 */
export interface NumberingRandomSource {
  nextInt(maxExclusive: number): number
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
