/**
 * 模板弹窗「适用事件」下拉的取值映射。
 *
 * reka-ui 的 `SelectItem` 明确拒绝空字符串 value（空值用于清空选择），
 * 因此「不指定事件」不能直接用 `''` 作为选项值，必须用哨兵值再映射回空事件。
 */
export const NO_TEMPLATE_EVENT_VALUE = '__none__'

export interface TemplateEventOptionSource {
  readonly eventType: string
  readonly label: string
}

export function templateEventSelectOptions(
  events: readonly TemplateEventOptionSource[],
): Array<{ label: string, value: string }> {
  return [
    { label: '不指定事件', value: NO_TEMPLATE_EVENT_VALUE },
    ...events.map(event => ({
      label: `${event.label}（${event.eventType}）`,
      value: event.eventType,
    })),
  ]
}

/** 事件类型 → 下拉值：空事件展示为「不指定事件」。 */
export function templateEventSelection(eventType: string): string {
  return eventType === '' ? NO_TEMPLATE_EVENT_VALUE : eventType
}

/** 下拉值 → 事件类型：哨兵值、空值与非法类型都归一为空事件。 */
export function templateEventFromSelection(value: unknown): string {
  return typeof value === 'string' && value !== NO_TEMPLATE_EVENT_VALUE ? value : ''
}
