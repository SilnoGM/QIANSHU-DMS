import type {
  NumberingActionPermissions,
  NumberingRuleActions,
} from './numbering-management.logic'
import type {
  NumberingRuleDetailDto,
  NumberingRuleIssuancesListData,
  NumberingRuleVersionDto,
  NumberingRuleVersionsListData,
} from '@/api/generated/types.gen'
import {
  formatNumberingRuleStructure,
  numberingResetPolicyLabel,
} from './numbering-list.logic'
import {
  buildNumberingIssuanceQuery,
  formatNumberingDecimal,
  resolveNumberingRuleActions,
} from './numbering-management.logic'

export type NumberingDetailTab = 'overview' | 'versions' | 'issuances'
export type NumberingDetailAction
  = 'clone' | 'disable' | 'edit' | 'enable' | 'publish'
export type NumberingLifecycleAction = 'disable' | 'enable' | 'publish'

export interface NumberingDetailTabItem {
  readonly icon: string
  readonly label: string
  readonly value: NumberingDetailTab
}

export interface NumberingIssuanceFilterModel {
  readonly consumerCode: string
  readonly generatedNumber: string
  readonly generatedNumberMatch: 'EXACT' | 'PREFIX'
  readonly periodKey: string
}

export interface NumberingVersionLoadInput {
  readonly page: number
  readonly pageSize: number
}

export interface NumberingIssuanceLoadInput extends NumberingVersionLoadInput {
  readonly filters: NumberingIssuanceFilterModel
}

export interface NumberingLifecyclePresentation {
  readonly action: NumberingLifecycleAction
  readonly canConfirm: boolean
  readonly confirmLabel: string
  readonly destructive: boolean
  readonly icon: string
  readonly impact: string
  readonly name: string
  readonly revision: number | null
  readonly revisionLabel: string
  readonly ruleCode: string
  readonly title: string
}

export interface NumberingVersionDescription {
  readonly capacity: string
  readonly resetPolicy: string
  readonly structure: string
  readonly timezone: 'Asia/Shanghai'
}

type NumberingVersionQuery
  = NonNullable<NumberingRuleVersionsListData['query']>
type NumberingIssuanceQuery
  = NonNullable<NumberingRuleIssuancesListData['query']>

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

const BASE_DETAIL_TABS: readonly NumberingDetailTabItem[] = [
  {
    icon: 'i-lucide:layout-dashboard',
    label: '概览',
    value: 'overview',
  },
  {
    icon: 'i-lucide:history',
    label: '版本',
    value: 'versions',
  },
]

const ISSUANCE_TAB: NumberingDetailTabItem = {
  icon: 'i-lucide:receipt-text',
  label: '发号记录',
  value: 'issuances',
}

function normalizePage(page: number): number {
  return Number.isSafeInteger(page) && page >= 1 ? page : DEFAULT_PAGE
}

function normalizePageSize(pageSize: number): number {
  return Number.isSafeInteger(pageSize)
    && pageSize >= 1
    && pageSize <= MAX_PAGE_SIZE
    ? pageSize
    : DEFAULT_PAGE_SIZE
}

/**
 * 发号记录是比规则详情更敏感的资源。前端同时检查两项权限只用于隐藏入口和
 * 阻止误请求；Server 仍是最终授权边界。
 */
export function canLoadNumberingIssuances(
  permissions: Pick<
    NumberingActionPermissions,
    'canRead' | 'canReadIssuances'
  >,
): boolean {
  return permissions.canRead && permissions.canReadIssuances
}

export function resolveNumberingDetailTabs(
  permissions: Pick<
    NumberingActionPermissions,
    'canRead' | 'canReadIssuances'
  >,
): readonly NumberingDetailTabItem[] {
  if (!permissions.canRead) {
    return []
  }
  return canLoadNumberingIssuances(permissions)
    ? [...BASE_DETAIL_TABS, ISSUANCE_TAB]
    : [...BASE_DETAIL_TABS]
}

/**
 * 详情 DTO 将 revision 收在版本对象中，列表动作规则则使用展平的 revision。
 * 此处只做无损形状适配，避免详情组件复制另一套权限和生命周期判断。
 */
export function resolveNumberingDetailActions(
  detail: NumberingRuleDetailDto | null,
  permissions: NumberingActionPermissions,
): NumberingRuleActions {
  if (detail === null || !permissions.canRead) {
    return {
      canClone: false,
      canDisable: false,
      canEdit: false,
      canEnable: false,
      canPublish: false,
      canReadIssuances: false,
      hasAny: false,
    }
  }

  return resolveNumberingRuleActions({
    activeRevision: detail.activeVersion?.revision ?? null,
    draftRevision: detail.draftVersion?.revision ?? null,
    status: detail.status,
  }, permissions)
}

/**
 * `hasAny` 还包含发号记录读取权限，而读取入口位于 tabs，不应因此创建空 footer。
 * footer 只关心会实际渲染按钮的五类维护动作。
 */
export function hasNumberingDetailFooterActions(
  actions: NumberingRuleActions,
): boolean {
  return actions.canEdit
    || actions.canClone
    || actions.canPublish
    || actions.canEnable
    || actions.canDisable
}

export function buildNumberingVersionLoadQuery(
  input: NumberingVersionLoadInput,
): NumberingVersionQuery {
  return {
    page: normalizePage(input.page),
    pageSize: normalizePageSize(input.pageSize),
  }
}

/**
 * 权限不足返回 null，调用方必须把它视为“禁止发出请求”。过滤值继续复用
 * 领域层白名单规范化，避免详情页和未来其他入口对 EXACT/PREFIX 产生分叉。
 */
export function buildNumberingIssuanceLoadQuery(
  input: NumberingIssuanceLoadInput,
  permissions: Pick<
    NumberingActionPermissions,
    'canRead' | 'canReadIssuances'
  >,
): NumberingIssuanceQuery | null {
  if (!canLoadNumberingIssuances(permissions)) {
    return null
  }

  return buildNumberingIssuanceQuery({
    ...input.filters,
    page: input.page,
    pageSize: input.pageSize,
  })
}

export function describeNumberingVersion(
  version: NumberingRuleVersionDto,
): NumberingVersionDescription {
  return {
    capacity: formatNumberingDecimal(version.capacity),
    resetPolicy: numberingResetPolicyLabel(version.config.resetPolicy),
    structure: formatNumberingRuleStructure(version.config),
    timezone: version.config.timezone,
  }
}

function activeRevision(detail: NumberingRuleDetailDto): number | null {
  return detail.activeVersion?.revision ?? null
}

/**
 * 确认弹窗只描述已经从最新详情快照中解析出的目标 revision。缺少所需版本时
 * 保留完整上下文但禁用确认，防止父页面误打开弹窗后提交含糊操作。
 */
export function buildNumberingLifecyclePresentation(
  action: NumberingLifecycleAction,
  detail: NumberingRuleDetailDto,
): NumberingLifecyclePresentation {
  if (action === 'publish') {
    const revision = detail.draftVersion?.revision ?? null
    return {
      action,
      title: '确认发布编号规则',
      confirmLabel: '确认发布',
      icon: 'i-lucide:upload-cloud',
      name: detail.name,
      ruleCode: detail.ruleCode,
      revision,
      revisionLabel: '草稿 revision',
      impact: revision === null
        ? '当前没有可发布的草稿版本，请刷新详情后重试。'
        : `发布后 revision ${revision} 成为新的生效版本；历史版本和已发出的编号保持不变。`,
      canConfirm: revision !== null,
      destructive: false,
    }
  }

  const revision = activeRevision(detail)
  if (action === 'enable') {
    return {
      action,
      title: '确认启用编号规则',
      confirmLabel: '确认启用',
      icon: 'i-lucide:circle-play',
      name: detail.name,
      ruleCode: detail.ruleCode,
      revision,
      revisionLabel: '生效 revision',
      impact: revision === null
        ? '当前没有生效版本，无法启用；请先发布草稿版本。'
        : `启用后将允许后续业务域调用该规则生成编号，并使用生效 revision ${revision}。`,
      canConfirm: revision !== null,
      destructive: false,
    }
  }

  return {
    action,
    title: '确认停用编号规则',
    confirmLabel: '确认停用',
    icon: 'i-lucide:circle-stop',
    name: detail.name,
    ruleCode: detail.ruleCode,
    revision,
    revisionLabel: '生效 revision',
    impact: revision === null
      ? '当前没有可停用的生效版本，请刷新详情后重试。'
      : `停用后将停止新的编号生成；revision ${revision}、既有编号、幂等重放与发号记录均保留。`,
    canConfirm: revision !== null,
    destructive: true,
  }
}
