import type {
  NotificationChannelPolicyDto,
  NotificationChannelPolicyUpdateDto,
} from '@/api/generated/types.gen'

export type NotificationChannelValue = 'IN_APP' | 'ASSISTANT'

export type PolicyTargetMode = 'COMMAND_TARGET' | 'USERS' | 'ROLE' | 'PERMISSION' | 'GROUP'

export interface PolicyTargetConfigDraft {
  permissionCode: string
  roleCodes: string[]
  targetKeys: string[]
  userIds: string[]
}

export interface PolicyDraft {
  targetMode: PolicyTargetMode
  targetConfig: PolicyTargetConfigDraft
  templateKey: string
  priority: 'NORMAL' | 'HIGH'
  ttlSeconds: number | null
  quietHoursEnabled: boolean
  quietStart: string
  quietEnd: string
  quietTimezone: string
  allowSensitive: boolean
  enabled: boolean
  expectedVersion: number
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : []
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function readPolicyTargetConfig(value: unknown): PolicyTargetConfigDraft {
  const record = asRecord(value)
  return {
    permissionCode: typeof record?.permissionCode === 'string' ? record.permissionCode : '',
    roleCodes: readStringList(record?.roleCodes),
    targetKeys: readStringList(record?.targetKeys),
    userIds: readStringList(record?.userIds),
  }
}

export function readQuietHours(value: unknown): { enabled: boolean, start: string, end: string, timezone: string } {
  const record = asRecord(value)
  return {
    enabled: record !== null,
    start: typeof record?.start === 'string' ? record.start : '22:00',
    end: typeof record?.end === 'string' ? record.end : '09:00',
    timezone: typeof record?.timezone === 'string' ? record.timezone : 'Asia/Shanghai',
  }
}

export function createPolicyDraft(
  policy: NotificationChannelPolicyDto | null,
  channel: NotificationChannelValue,
): PolicyDraft {
  const quiet = readQuietHours(policy?.quietHours)
  return {
    targetMode: (policy?.targetMode ?? 'COMMAND_TARGET') as PolicyTargetMode,
    targetConfig: readPolicyTargetConfig(policy?.targetConfig),
    templateKey: policy?.templateKey ?? '',
    priority: (policy?.priority ?? 'NORMAL') as 'NORMAL' | 'HIGH',
    ttlSeconds: policy?.ttlSeconds ?? (channel === 'ASSISTANT' ? 86_400 : null),
    quietHoursEnabled: quiet.enabled,
    quietStart: quiet.start,
    quietEnd: quiet.end,
    quietTimezone: quiet.timezone,
    allowSensitive: policy?.allowSensitive ?? true,
    enabled: policy?.enabled ?? false,
    expectedVersion: policy?.version ?? 0,
  }
}

export function buildPolicyTargetConfig(draft: PolicyDraft): Record<string, unknown> {
  if (draft.targetMode === 'USERS') {
    return { userIds: draft.targetConfig.userIds }
  }
  if (draft.targetMode === 'ROLE') {
    return { roleCodes: draft.targetConfig.roleCodes }
  }
  if (draft.targetMode === 'PERMISSION') {
    return { permissionCode: draft.targetConfig.permissionCode }
  }
  if (draft.targetMode === 'GROUP') {
    return { targetKeys: draft.targetConfig.targetKeys }
  }
  return {}
}

export function buildPolicyUpdate(
  draft: PolicyDraft,
  channel: NotificationChannelValue,
): NotificationChannelPolicyUpdateDto {
  const quietHours = channel === 'ASSISTANT' && draft.quietHoursEnabled
    ? {
        start: draft.quietStart,
        end: draft.quietEnd,
        timezone: draft.quietTimezone,
      }
    : null
  return {
    targetMode: draft.targetMode,
    targetConfig: buildPolicyTargetConfig(draft),
    templateKey: draft.templateKey.trim() || null,
    priority: draft.priority,
    ttlSeconds: channel === 'ASSISTANT' ? draft.ttlSeconds : null,
    quietHours,
    allowSensitive: draft.allowSensitive,
    enabled: draft.enabled,
    expectedVersion: draft.expectedVersion,
  }
}

export function canSavePolicyDraft(
  draft: PolicyDraft,
  channel: NotificationChannelValue,
  canUpdate: boolean,
): boolean {
  if (!canUpdate) {
    return false
  }
  if (draft.targetMode === 'USERS' && draft.targetConfig.userIds.length === 0) {
    return false
  }
  if (draft.targetMode === 'ROLE' && draft.targetConfig.roleCodes.length === 0) {
    return false
  }
  if (draft.targetMode === 'PERMISSION' && draft.targetConfig.permissionCode.length === 0) {
    return false
  }
  if (draft.targetMode === 'GROUP' && draft.targetConfig.targetKeys.length === 0) {
    return false
  }
  if (channel === 'IN_APP' && draft.targetMode === 'GROUP') {
    return false
  }
  if (channel === 'ASSISTANT') {
    const ttl = draft.ttlSeconds
    return Number.isInteger(ttl) && ttl !== null && ttl >= 60 && ttl <= 604_800
  }
  return true
}

export function policyTtlHint(seconds: number | null): string {
  return seconds !== null && Number.isFinite(seconds) && seconds >= 60 && seconds <= 604_800
    ? `约 ${(seconds / 3600).toFixed(1)} 小时；范围 60–604800 秒`
    : '范围 60–604800 秒（1 分钟–7 天）'
}

export function policyDraftSignature(draft: PolicyDraft): string {
  return JSON.stringify(draft)
}
