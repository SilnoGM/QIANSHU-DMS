export interface QsStatusSwitchItem {
  /** 稳定的状态值，由调用方负责与筛选参数保持一致。 */
  readonly value: string
  /** 面向用户展示的状态名称。 */
  readonly label: string
  /** 可选统计数量；未传入时不预留计数位置。 */
  readonly count?: number
  /** 禁用后保留展示，但不允许用户切换到该状态。 */
  readonly disabled?: boolean
}

export interface QsStatusSwitchOverflowMetrics {
  readonly clientWidth: number
  readonly scrollLeft: number
  readonly scrollWidth: number
}
