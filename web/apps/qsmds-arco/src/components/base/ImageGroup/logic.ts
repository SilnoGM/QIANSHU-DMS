import type {
  ImageGroupEntry,
  ImageGroupItem,
  ImageGroupRadius,
  ImageGroupSize,
  NormalizedImageGroupItem,
} from './types'

export const IMAGE_GROUP_DEFAULT_MAX_COUNT = 4
export const IMAGE_GROUP_DEFAULT_SIZE = 40

const IMAGE_GROUP_SIZE_VALUES = {
  lg: 48,
  md: IMAGE_GROUP_DEFAULT_SIZE,
  sm: 32,
} as const

const IMAGE_GROUP_RADIUS_CLASSES = {
  full: 'rounded-full',
  lg: 'rounded-lg',
  md: 'rounded-md',
  none: 'rounded-none',
  sm: 'rounded-sm',
} as const

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

/**
 * 图片地址只用于判断当前项是否可展示，不修改调用方传入的字符串。
 * 签名 URL、对象存储地址等值可能对空格之外的字符敏感，组件不承担 URL 归一化。
 */
export function normalizeImageGroupItems(
  items: readonly ImageGroupItem[],
): NormalizedImageGroupItem[] {
  return items
    .filter(item => item.src.trim().length > 0)
    .map((item, index) => ({
      index,
      item,
      key: String(item.key ?? `${item.src}-${index}`),
    }))
}

/**
 * 加载状态必须同时绑定稳定业务 key 与当前 URL。只使用业务 key 会让同 key 换图时
 * 沿用旧状态，只使用 URL 又无法区分调用方有意提供的不同图片项。
 */
export function resolveImageGroupStateKey(item: NormalizedImageGroupItem): string {
  return JSON.stringify([item.key, item.item.src])
}

/**
 * 数据刷新时只丢弃已移除或 URL 已变化图片的状态。若列表查询返回同一批媒体，
 * 浏览器通常复用已完成的 img 且不会再次触发 load，因此必须保留对应 loaded 状态。
 */
export function retainImageGroupStateKeys(
  stateKeys: ReadonlySet<string>,
  items: readonly NormalizedImageGroupItem[],
): Set<string> {
  const activeKeys = new Set(items.map(resolveImageGroupStateKey))
  return new Set([...stateKeys].filter(key => activeKeys.has(key)))
}

/**
 * 数字尺寸限制在 24–96px。下限保证失败图标和键盘焦点环仍可辨识，上限避免
 * 通用基础组件被误用成大幅画廊并破坏表格或窄屏卡片布局。
 */
export function resolveImageGroupSize(size: ImageGroupSize = 'md'): number {
  if (typeof size !== 'number') {
    return IMAGE_GROUP_SIZE_VALUES[size]
  }
  if (!Number.isFinite(size)) {
    return IMAGE_GROUP_DEFAULT_SIZE
  }
  return clamp(Math.round(size), 24, 96)
}

export function resolveImageGroupMaxCount(maxCount = IMAGE_GROUP_DEFAULT_MAX_COUNT): number {
  if (!Number.isFinite(maxCount)) {
    return IMAGE_GROUP_DEFAULT_MAX_COUNT
  }
  return Math.max(2, Math.trunc(maxCount))
}

/**
 * 默认重叠量为图片尺寸的四分之一；自定义值最多保留 8px 可见宽度，避免后续图片
 * 完全遮住前一张图片，导致鼠标和键盘用户无法感知组内数量。
 */
export function resolveImageGroupOverlap(
  overlap: number | undefined,
  size: number,
): number {
  const defaultOverlap = Math.round(size * 0.25)
  if (overlap === undefined || !Number.isFinite(overlap)) {
    return defaultOverlap
  }
  return clamp(Math.round(overlap), 0, Math.max(0, size - 8))
}

export function resolveImageGroupRadius(radius: ImageGroupRadius = 'md'): {
  className: string | undefined
  style: string | undefined
} {
  if (typeof radius !== 'number') {
    return {
      className: IMAGE_GROUP_RADIUS_CLASSES[radius],
      style: undefined,
    }
  }
  if (!Number.isFinite(radius)) {
    return {
      className: IMAGE_GROUP_RADIUS_CLASSES.md,
      style: undefined,
    }
  }
  return {
    className: undefined,
    style: `${Math.max(0, radius)}px`,
  }
}

/**
 * +N 自身占用一个可见位置。因此超出上限时只展示 maxCount - 1 张真实图片，
 * 点击溢出项从第一张隐藏图片开始打开既有整组预览器。
 */
export function createImageGroupEntries(
  items: readonly NormalizedImageGroupItem[],
  maxCount: number,
): ImageGroupEntry[] {
  const resolvedMaxCount = resolveImageGroupMaxCount(maxCount)
  if (items.length <= resolvedMaxCount) {
    return items.map(image => ({
      image,
      type: 'image',
    }))
  }

  const visibleCount = resolvedMaxCount - 1
  return [
    ...items.slice(0, visibleCount).map(image => ({
      image,
      type: 'image' as const,
    })),
    {
      hiddenCount: items.length - visibleCount,
      previewIndex: visibleCount,
      type: 'overflow',
    },
  ]
}

export function resolveImageGroupTooltip(
  item: ImageGroupItem,
  index: number,
): string {
  return item.tooltip?.trim()
    || item.alt?.trim()
    || `第 ${index + 1} 张图片`
}
