let graphemeSegmenter: Intl.Segmenter | undefined

function getGraphemeSegmenter(): Intl.Segmenter {
  /*
   * 这是正式应用内部的可见文本工具。共享组件包有自己的私有实现，避免让应用
   * 跨目录依赖组件内部源码，也避免为了两个小函数扩张公共 package API。
   */
  graphemeSegmenter ??= new Intl.Segmenter(undefined, {
    granularity: 'grapheme',
  })
  return graphemeSegmenter
}

/**
 * 按用户看到的字素簇计数，避免把 ZWJ、肤色、国旗或组合附加符号拆成多段。
 * 此函数只服务 UI 展示；提交给 Server 的字段长度仍遵循既有 Unicode 码点契约。
 */
export function countGraphemes(value: string): number {
  return Array.from(getGraphemeSegmenter().segment(value)).length
}
