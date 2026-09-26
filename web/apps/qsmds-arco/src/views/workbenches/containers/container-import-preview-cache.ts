import type { ContainerImportPreviewDto } from '@/api/generated/types.gen'

// 柜次详情的解析与解析匹配页首屏是同一次解析，这里只承担「点击解析 → 立即跳转」之间的内存交接：
// 不做持久化，读取即消费，避免稍后直接进入解析匹配页时误用上一次的解析结果。
const staged = new Map<string, ContainerImportPreviewDto>()

export function stageImportPreview(id: string, preview: ContainerImportPreviewDto): void {
  if (id && preview.containerBatchId === id) {
    staged.set(id, preview)
  }
}

export function takeImportPreview(id: string): ContainerImportPreviewDto | null {
  const preview = staged.get(id) ?? null
  staged.delete(id)
  return preview
}
