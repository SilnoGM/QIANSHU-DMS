import type {
  NumberingActionPermissions,
} from './numbering-management.logic'

export type NumberingEditorMode = 'clone' | 'create' | 'edit'

export interface NumberingContextResponseGuardInput {
  readonly aborted: boolean
  readonly authorized: boolean
  readonly authEpoch: number
  readonly currentAuthEpoch: number
  readonly latestRequestVersion: number
  readonly requestVersion: number
}

export interface NumberingMutationResultGuardInput {
  readonly authorized: boolean
  readonly authEpoch: number
  readonly currentAuthEpoch: number
  readonly currentGeneration: number
  readonly currentTargetId: string | null
  readonly generation: number
  readonly targetId: string | null
}

/**
 * 详情、版本、发号记录与预览都是可取消查询。完成顺序不可信，
 * 只有请求仍处于当前身份、当前权限和最新版本边界才能回填页面。
 */
export function canApplyNumberingContextResponse(
  input: NumberingContextResponseGuardInput,
): boolean {
  return !input.aborted
    && input.authorized
    && input.authEpoch === input.currentAuthEpoch
    && input.requestVersion === input.latestRequestVersion
}

/**
 * mutation 无法像 GET 一样安全取消，因此响应完成后再校验身份、权限、操作代次
 * 与目标上下文。旧身份或已被清理的请求可以在 Server 完成，但不得污染当前 UI。
 */
export function canApplyNumberingMutationResult(
  input: NumberingMutationResultGuardInput,
): boolean {
  return input.authorized
    && input.authEpoch === input.currentAuthEpoch
    && input.generation === input.currentGeneration
    && input.targetId === input.currentTargetId
}

/** 编辑器按当前模式使用最小权限集，动态撤权时不保留敏感上下文。 */
export function shouldCloseNumberingEditor(
  mode: NumberingEditorMode,
  permissions: NumberingActionPermissions,
): boolean {
  if (!permissions.canRead) {
    return true
  }
  if (mode === 'edit') {
    return !permissions.canUpdate
  }
  return !permissions.canCreate
}

/** Server 与 Web 都要求两项权限，不得因为 tab 曾经打开而继续请求。 */
export function shouldLoadNumberingIssuances(
  permissions: NumberingActionPermissions,
): boolean {
  return permissions.canRead && permissions.canReadIssuances
}
