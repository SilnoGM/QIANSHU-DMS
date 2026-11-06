/**
 * 柜次列表「绑定统计」的展示判定：绑定按装柜明细行计，一行对应一个 shipmentId。
 * 规则只服务展示，不作为装柜资格或结算依据；文案 key 与色值集中在这里，避免列和移动端卡片各写一份。
 */
export type ContainerBindingState = 'ALL' | 'PARTIAL' | 'NONE' | 'EMPTY'

export interface ContainerBindingStats {
  readonly state: ContainerBindingState
  readonly bound: number
  readonly total: number
  readonly labelKey: string
  readonly toneClass: string
  readonly tagClass: string
}

const toneByState: Record<ContainerBindingState, string> = {
  ALL: 'text-emerald-600 dark:text-emerald-400',
  PARTIAL: 'text-amber-600 dark:text-amber-400',
  NONE: 'text-destructive',
  EMPTY: 'text-muted-foreground',
}

// 标签沿用订单/货件状态标签的配色口径：浅底 + 同色描边 + 深一档文字，深色模式回落到 300。
const tagByState: Record<ContainerBindingState, string> = {
  ALL: 'text-emerald-700 border-emerald-500/30 bg-emerald-500/10 dark:text-emerald-300',
  PARTIAL: 'text-amber-700 border-amber-500/30 bg-amber-500/10 dark:text-amber-300',
  NONE: 'text-destructive border-destructive/30 bg-destructive/10',
  EMPTY: 'text-muted-foreground border-border bg-muted/40',
}

const labelByState: Record<Exclude<ContainerBindingState, 'EMPTY'>, string> = {
  ALL: 'containerPage.bindingAll',
  PARTIAL: 'containerPage.bindingPartial',
  NONE: 'containerPage.bindingNone',
}

function count(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export function resolveContainerBindingStats(boundItemCount: number, itemCount: number): ContainerBindingStats {
  const total = count(itemCount)
  // 已绑定行数不允许超过总行数；服务端两者同源，这里只兜住未来口径变化时的错位展示。
  const bound = Math.min(count(boundItemCount), total)
  const state: ContainerBindingState = total === 0 ? 'EMPTY' : bound === 0 ? 'NONE' : bound === total ? 'ALL' : 'PARTIAL'
  return {
    state,
    bound,
    total,
    labelKey: state === 'EMPTY' ? 'containerPage.bindingEmpty' : labelByState[state],
    toneClass: toneByState[state],
    tagClass: tagByState[state],
  }
}
