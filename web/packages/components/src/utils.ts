import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

let graphemeSegmenter: Intl.Segmenter | undefined

function getGraphemeSegmenter(): Intl.Segmenter {
  /*
   * Intl.Segmenter 是运行时原生能力，不引入字体或第三方依赖。这里保持为组件包
   * 私有工具，不从 package root 导出，避免把实现细节变成公共 API 契约。
   */
  graphemeSegmenter ??= new Intl.Segmenter(undefined, {
    granularity: 'grapheme',
  })
  return graphemeSegmenter
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 按用户看到的字素簇拆分文本，不拆开组合 Emoji 或附加符号。 */
export function splitGraphemes(value: string): string[] {
  return Array.from(
    getGraphemeSegmenter().segment(value),
    segment => segment.segment,
  )
}

/** 按用户看到的完整字素簇计数，供纯展示型规则和提示使用。 */
export function countGraphemes(value: string): number {
  return Array.from(getGraphemeSegmenter().segment(value)).length
}

/** 取得前若干个完整字素簇，供头像等可见文本降级内容使用。 */
export function takeGraphemes(value: string, limit: number): string {
  if (limit <= 0) {
    return ''
  }
  return splitGraphemes(value).slice(0, limit).join('')
}
