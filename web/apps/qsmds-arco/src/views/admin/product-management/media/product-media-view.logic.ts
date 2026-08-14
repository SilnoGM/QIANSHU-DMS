import type { ProductMediaItemDto } from '../../../../api/generated/types.gen'

export interface ProductMediaSelectionFeedback {
  readonly filename: string
  readonly id: string
  readonly message: string
}

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB'] as const

function trimFraction(value: string): string {
  return value.replace(/\.00$/u, '').replace(/(\.\d)0$/u, '$1')
}

/**
 * 媒体大小来自 Server 的十进制字符串。界面只在已验证为非负安全整数后参与
 * 浮点格式化，避免把异常传输值渲染成 NaN 或误导性的容量。
 */
export function formatProductMediaBytes(sizeBytes: string): string {
  if (!/^\d+$/u.test(sizeBytes)) {
    return '—'
  }
  const bytes = Number(sizeBytes)
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    return '—'
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    BYTE_UNITS.length - 1,
  )
  const amount = bytes / 1024 ** unitIndex
  return `${trimFraction(amount.toFixed(2))} ${BYTE_UNITS[unitIndex]}`
}

export function formatProductMediaDuration(durationMs: number | null): string {
  if (
    durationMs === null
    || !Number.isSafeInteger(durationMs)
    || durationMs < 0
  ) {
    return '—'
  }
  const totalSeconds = Math.floor(durationMs / 1000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  const parts = hours > 0
    ? [hours, minutes, seconds]
    : [totalMinutes, seconds]
  return parts.map(value => String(value).padStart(2, '0')).join(':')
}

/** 解除成功后优先聚焦原位置的下一项，末项则回到上一项。 */
export function getProductMediaFocusTargetId(
  orderedIds: readonly string[],
  removedId: string,
): string | null {
  const index = orderedIds.indexOf(removedId)
  if (index < 0) {
    return null
  }
  return orderedIds[index + 1] ?? orderedIds[index - 1] ?? null
}

/**
 * 布局 draft 只保存 stable ID；渲染前必须与 Product DTO 精确对齐，防止静默
 * 丢失、重复或混入另一类型媒体。
 */
export function orderProductMediaItems(
  items: readonly ProductMediaItemDto[],
  orderedIds: readonly string[],
): ProductMediaItemDto[] {
  const byId = new Map(items.map(item => [item.id, item]))
  if (
    byId.size !== items.length
    || orderedIds.length !== items.length
    || new Set(orderedIds).size !== orderedIds.length
  ) {
    throw new TypeError('媒体渲染顺序必须精确覆盖当前 stable ID')
  }
  return orderedIds.map((id) => {
    const item = byId.get(id)
    if (item === undefined) {
      throw new TypeError('媒体渲染顺序包含未知 stable ID')
    }
    return item
  })
}

export function getProductMediaProgressPercent(
  loadedBytes: number,
  totalBytes: number,
): number {
  if (
    !Number.isSafeInteger(loadedBytes)
    || !Number.isSafeInteger(totalBytes)
    || loadedBytes < 0
    || totalBytes <= 0
  ) {
    return 0
  }
  return Math.min(100, Math.round((loadedBytes / totalBytes) * 100))
}
