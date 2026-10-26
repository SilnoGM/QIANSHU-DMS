import { resolveActionColumnWidth } from '../../../components/business/QsGenericTable/action-column-width'

/**
 * 装柜明细操作列按最宽形态定宽：只读或上传保存期间 canEdit 会临时为 false，
 * 行内同时出现两个四字详情，再加更多菜单图标。固定为 232px，避免列宽随临时状态抖动。
 */
export const CONTAINER_ITEM_ACTION_COLUMN_WIDTH = resolveActionColumnWidth([
  { chars: 4, kind: 'text' },
  { chars: 4, kind: 'text' },
  { kind: 'icon' },
])
