/**
 * 操作列宽度按「最多可能出现的按钮集合」计算，不按当前行实际渲染内容测量。
 * 这样翻页、筛选和权限变化不会让固定右列反复跳动。
 */
export type ActionWidthSpec
  = | { kind: 'icon' }
    | { kind: 'text', chars: number }
    | { kind: 'text-with-icon', chars: number }

export interface ActionMenuItem {
  disabled?: boolean
  handle: () => void
  icon?: string
  label: string
  variant?: 'default' | 'destructive'
}

const CELL_PADDING = 24
const BUTTON_GAP = 4
const COLUMN_BUFFER = 8

function buttonWidth(action: ActionWidthSpec): number {
  if (action.kind === 'icon') {
    return 32
  }
  if (action.kind === 'text') {
    return 24 + action.chars * 14
  }
  return 44 + action.chars * 14
}

export function resolveActionColumnWidth(actions: readonly ActionWidthSpec[]): number {
  return CELL_PADDING
    + actions.reduce((sum, action) => sum + buttonWidth(action), 0)
    + BUTTON_GAP * Math.max(0, actions.length - 1)
    + COLUMN_BUFFER
}
