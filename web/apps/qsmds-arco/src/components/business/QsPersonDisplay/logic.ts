export const UNKNOWN_PERSON_DISPLAY_NAME = '未知人员'

let graphemeSegmenter: Intl.Segmenter | undefined

function getGraphemeSegmenter(): Intl.Segmenter {
  // 头像回退必须按用户看到的字素簇截取，避免拆开肤色、ZWJ 或组合附加符号。
  graphemeSegmenter ??= new Intl.Segmenter(undefined, {
    granularity: 'grapheme',
  })
  return graphemeSegmenter
}

/**
 * 统一清理展示名称；人员主数据缺失时仍输出可理解的稳定文案。
 */
export function normalizePersonDisplayName(displayName: string): string {
  return displayName.trim() || UNKNOWN_PERSON_DISPLAY_NAME
}

/**
 * 头像无图片或图片加载失败时，只显示归一化名称的第一个可见字符。
 */
export function getPersonDisplayFallback(displayName: string): string {
  const normalizedName = normalizePersonDisplayName(displayName)
  return Array.from(getGraphemeSegmenter().segment(normalizedName))[0]?.segment ?? '未'
}
