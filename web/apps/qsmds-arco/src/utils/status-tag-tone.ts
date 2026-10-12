/**
 * 状态标签的语义色板：采购订单详情与对账详情共用同一套色调取值与类名，
 * 避免两处各写一份「状态 → 颜色」硬编码（色调语义固定五档，新增维度只选档、不改色）。
 */
export type QsStatusTagTone = 'danger' | 'info' | 'neutral' | 'success' | 'warning'

const TONE_CLASSES: Readonly<Record<QsStatusTagTone, string>> = {
  danger: 'border-destructive/35 bg-destructive/10 text-destructive',
  info: 'border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  neutral: 'border-border bg-muted/60 text-muted-foreground',
  success: 'border-primary/35 bg-primary/10 text-primary',
  warning: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
}

export function resolveStatusTagToneClass(tone: QsStatusTagTone): string {
  return TONE_CLASSES[tone]
}
