import type {
  NumberingRuleFormModel,
  NumberingRuleSegment,
} from './numbering-management.logic'

export type NumberingSegmentType = NumberingRuleSegment['type']
export type NumberingRuleEditorMode = 'clone' | 'create' | 'edit'
export type NumberingSegmentAction = 'down' | 'remove' | 'up'

export interface NumberingRuleEditorDrawerExpose {
  closeForAuthorityLoss: () => void
  closeWithoutDirtyGuard: () => void
}

export interface NumberingEditorCloseBypass {
  /** 允许下一次关闭跳过 dirty 确认。许可在消费后立即失效。 */
  arm: () => void
  /** 消费一次许可；未 armed 时返回 false。 */
  consume: () => boolean
  /** 主动撤销尚未消费的许可。 */
  reset: () => void
}

const NUMBERING_SEGMENT_TYPE_LABELS: Record<NumberingSegmentType, string> = {
  DATE: '日期',
  FIXED: '固定字符',
  RANDOM: '随机字符串',
  SEPARATOR: '分隔符',
  SEQUENCE: '自增数字',
}

const NUMBERING_SEGMENT_ACTION_LABELS: Record<
  NumberingSegmentAction,
  string
> = {
  down: '下移',
  remove: '删除',
  up: '上移',
}

/**
 * 图标按钮名称包含可见序号与片段类型。屏幕阅读器用户无需根据相邻视觉内容
 * 猜测操作目标，调整顺序后名称也会随当前列表位置同步更新。
 */
export function formatNumberingSegmentActionLabel(
  action: NumberingSegmentAction,
  index: number,
  type: NumberingSegmentType,
): string {
  return `${NUMBERING_SEGMENT_ACTION_LABELS[action]}第 ${index + 1} 个${NUMBERING_SEGMENT_TYPE_LABELS[type]}片段`
}

function cloneNumberingSegment(
  segment: NumberingRuleSegment,
): NumberingRuleSegment {
  // 当前联合类型均为一层扁平对象；显式复制防止父子表单共享可变片段引用。
  return { ...segment }
}

/**
 * 编辑器始终使用父层模型的隔离副本。clone 模式的业务初始化仍由父层决定，
 * 组件边界只保证任一模式下都不会就地修改传入对象。
 */
export function cloneNumberingRuleFormModel(
  model: Readonly<NumberingRuleFormModel>,
): NumberingRuleFormModel {
  return {
    description: model.description,
    name: model.name,
    resetPolicy: model.resetPolicy,
    ruleCode: model.ruleCode,
    segments: model.segments.map(cloneNumberingSegment),
  }
}

function fingerprintNumberingRuleFormModel(
  model: Readonly<NumberingRuleFormModel>,
): string {
  // 字段顺序由本函数固定，避免调用方对象键顺序影响 dirty 判断。
  return JSON.stringify(cloneNumberingRuleFormModel(model))
}

export function isNumberingRuleFormDirty(
  current: Readonly<NumberingRuleFormModel>,
  baseline: Readonly<NumberingRuleFormModel>,
): boolean {
  return fingerprintNumberingRuleFormModel(current)
    !== fingerprintNumberingRuleFormModel(baseline)
}

export function createNumberingSegment(
  type: NumberingSegmentType,
): NumberingRuleSegment {
  switch (type) {
    case 'FIXED':
      return { type: 'FIXED', value: 'PREFIX' }
    case 'DATE':
      return { type: 'DATE', format: 'YYYYMMDD' }
    case 'SEPARATOR':
      return { type: 'SEPARATOR', value: '-' }
    case 'SEQUENCE':
      return {
        type: 'SEQUENCE',
        width: 6,
        startValue: '1',
        step: '1',
      }
    case 'RANDOM':
      return {
        type: 'RANDOM',
        letterLength: 4,
        digitLength: 4,
        mode: 'LETTERS_THEN_DIGITS',
      }
  }
}

export function replaceNumberingSegment(
  segments: readonly NumberingRuleSegment[],
  index: number,
  segment: NumberingRuleSegment,
): NumberingRuleSegment[] {
  return segments.map((current, position) =>
    cloneNumberingSegment(position === index ? segment : current))
}

/**
 * 数字输入在空值或非法中间态下落为 0，让既有表单校验输出明确错误，且不会把
 * NaN 传播到 preview 请求。有效输入只接受十进制整数。
 */
export function coerceNumberingEditorInteger(value: unknown): number {
  const normalized = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/u.test(value.trim())
      ? Number(value.trim())
      : 0
  return Number.isSafeInteger(normalized) ? normalized : 0
}

export function resolveNumberingEditorFieldErrors(
  localErrors: Readonly<Record<string, string>>,
  serverErrors: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  // 本地错误对应用户当前输入，优先级高于可能来自上一轮请求的 Server 错误。
  return { ...serverErrors, ...localErrors }
}

export function createNumberingEditorCloseBypass(): NumberingEditorCloseBypass {
  let armed = false

  return {
    arm() {
      armed = true
    },
    consume() {
      const allowed = armed
      armed = false
      return allowed
    },
    reset() {
      armed = false
    },
  }
}
