/**
 * 状态语义色板：组件只认 tone，不认任何状态字面量。
 * 具体颜色在 logic 的 LINE_SWITCHER_TONE_BAR_CLASSES 中映射，调用方通过 statusTones 指定。
 */
export type QsReconciliationLineSwitcherTone = 'danger' | 'success' | 'warning' | 'neutral'

export interface QsReconciliationLineSwitcherItem {
  /** 稳定标识（明细行 id）；组件把它用作列表 key 与 v-model 值。 */
  readonly value: string
  /** 面向用户展示的短标签，对账域传唛头。 */
  readonly label: string
  /** 状态取值，由调用方定义；组件只用它查 statusTones。 */
  readonly status: string
  /** 可选：无障碍朗读用的状态文案，缺省回退到 status。 */
  readonly statusLabel?: string
}
