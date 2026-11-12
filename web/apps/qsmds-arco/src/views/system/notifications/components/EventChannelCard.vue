<script setup lang="ts">
import type { EffectiveTemplate, PolicyOptionLists } from '../event-config.logic'
import type { PolicyDraft } from '../policy-draft.logic'
import type { NotificationChannelPolicyDto, NotificationEventDto, NotificationTemplateDto } from '@/api/generated/types.gen'

import { computed } from 'vue'

import { canSavePolicyDraft, policyTtlHint } from '../policy-draft.logic'
import { formatNotificationDateTime } from '../template-key-grouping.logic'
import EventTemplateBlock from './EventTemplateBlock.vue'

const props = withDefaults(defineProps<{
  busy: boolean
  canUpdatePolicy: boolean
  canUpdateTemplate: boolean
  canViewTemplate: boolean
  channel: 'IN_APP' | 'ASSISTANT'
  dirty: boolean
  effective: EffectiveTemplate
  event: NotificationEventDto
  options: PolicyOptionLists
  policy: NotificationChannelPolicyDto | null
  variant?: 'card' | 'drawer'
}>(), {
  variant: 'card',
})

const emit = defineEmits<{
  create: [key: string]
  edit: [template: NotificationTemplateDto]
  pick: []
  preview: [template: NotificationTemplateDto]
  reset: []
  resetDefault: []
  save: []
}>()

const draft = defineModel<PolicyDraft>('draft', { required: true })

const channelLabel = computed(() => props.channel === 'ASSISTANT' ? '千树小助理' : '站内通知')
const channelIcon = computed(() => props.channel === 'ASSISTANT' ? 'i-lucide:messages-square' : 'i-lucide:bell')
const isDrawer = computed(() => props.variant === 'drawer')
const articleClass = computed(() => isDrawer.value
  ? 'flex flex-col gap-4 min-w-0'
  : 'p-4 border border-border rounded-xl bg-background flex flex-col gap-4 min-w-0 h-full')
const channelIconClass = computed(() => props.channel === 'ASSISTANT'
  ? 'bg-primary/10 text-primary'
  : 'bg-sky-500/10 text-sky-600 dark:text-sky-300')

const targetModeOptions = computed(() => [
  { label: '使用命令目标', value: 'COMMAND_TARGET' },
  { label: '固定员工', value: 'USERS' },
  { label: '角色', value: 'ROLE' },
  { label: '权限', value: 'PERMISSION' },
  ...(props.channel === 'ASSISTANT' ? [{ label: '群目标', value: 'GROUP' }] : []),
])

const canSave = computed(() => (props.policy === null || props.dirty)
  && canSavePolicyDraft(draft.value, props.channel, props.canUpdatePolicy))
const ttlHint = computed(() => policyTtlHint(draft.value.ttlSeconds))

function updateTtl(value: number | '' | undefined): void {
  draft.value.ttlSeconds = typeof value === 'number' && Number.isFinite(value) ? value : null
}

const stateLabel = computed(() => {
  if (props.policy === null) {
    return '待创建'
  }
  if (props.dirty) {
    return '待保存'
  }
  if (props.effective.state === 'READY') {
    return '就绪'
  }
  if (props.effective.state === 'MISSING_TEMPLATE') {
    return '缺模板'
  }
  if (props.effective.state === 'DISABLED') {
    return '已停用'
  }
  if (props.effective.state === 'UNKNOWN') {
    return '待确认'
  }
  return '未配置'
})

const stateClass = computed(() => {
  if (props.policy === null || props.dirty) {
    return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
  }
  if (props.effective.state === 'READY') {
    return 'border-primary/30 bg-primary/10 text-primary'
  }
  if (props.effective.state === 'MISSING_TEMPLATE') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }
  if (props.effective.state === 'DISABLED') {
    return 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
  }
  return 'border-border bg-muted text-muted-foreground'
})
</script>

<template>
  <article
    :class="articleClass"
    :data-testid="`notification-channel-card-${channel}`"
  >
    <header class="flex flex-wrap gap-2 items-center justify-between">
      <div v-if="!isDrawer" class="flex gap-2 min-w-0 items-center">
        <span class="rounded-md flex shrink-0 size-8 items-center justify-center" :class="channelIconClass">
          <FaIcon :name="channelIcon" class="size-4" aria-hidden="true" />
        </span>
        <div class="min-w-0">
          <p class="qs-type-body-medium m-0">
            {{ channelLabel }}
          </p>
          <p class="qs-type-meta text-muted-foreground m-0">
            {{ policy === null ? '尚未创建策略' : `版本 ${policy.version}` }}
          </p>
        </div>
      </div>
      <span v-else class="qs-type-meta text-muted-foreground">
        {{ policy === null ? '尚未创建策略' : `策略版本 ${policy.version}` }}
      </span>
      <div class="flex flex-wrap gap-2 items-center">
        <FaTag variant="outline" :class="stateClass">
          {{ stateLabel }}
        </FaTag>
        <label class="qs-type-meta flex gap-1.5 items-center">
          启用
          <FaSwitch
            v-model="draft.enabled"
            :disabled="!canUpdatePolicy || busy"
            :aria-label="`${channelLabel}策略启用状态`"
          />
        </label>
        <FaButton
          v-if="!isDrawer"
          size="sm"
          :disabled="!canSave || busy"
          :aria-label="`${policy === null ? '创建' : '保存'}${channelLabel}策略`"
          @click="emit('save')"
        >
          {{ policy === null ? '创建' : '保存' }}
        </FaButton>
      </div>
    </header>

    <section class="flex flex-col gap-2">
      <p class="qs-type-compact-label m-0">
        投递配置
      </p>
      <div class="gap-3 grid sm:grid-cols-2">
        <label class="flex flex-col gap-1">
          <span class="qs-type-meta text-muted-foreground">目标模式</span>
          <FaSelect v-model="draft.targetMode" :options="targetModeOptions" :disabled="!canUpdatePolicy || busy" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="qs-type-meta text-muted-foreground">优先级</span>
          <FaSelect
            v-model="draft.priority"
            :options="[{ label: '普通', value: 'NORMAL' }, { label: '高', value: 'HIGH' }]"
            :disabled="!canUpdatePolicy || busy"
          />
        </label>
      </div>

      <div v-if="draft.targetMode === 'COMMAND_TARGET'" class="qs-type-meta text-muted-foreground p-2.5 border border-border rounded-md bg-muted/30">
        目标由业务命令携带，不需要额外配置。
      </div>
      <label v-else-if="draft.targetMode === 'USERS'" class="flex flex-col gap-1">
        <span class="qs-type-meta text-muted-foreground">员工范围</span>
        <FaSelect
          v-model="draft.targetConfig.userIds"
          multiple
          :options="options.users"
          :disabled="!canUpdatePolicy || busy"
          placeholder="选择员工"
        />
        <span class="qs-type-meta text-muted-foreground">已选 {{ draft.targetConfig.userIds.length }} 人</span>
      </label>
      <label v-else-if="draft.targetMode === 'ROLE'" class="flex flex-col gap-1">
        <span class="qs-type-meta text-muted-foreground">角色范围</span>
        <FaSelect
          v-model="draft.targetConfig.roleCodes"
          multiple
          :options="options.roles"
          :disabled="!canUpdatePolicy || busy"
          placeholder="选择角色"
        />
      </label>
      <label v-else-if="draft.targetMode === 'PERMISSION'" class="flex flex-col gap-1">
        <span class="qs-type-meta text-muted-foreground">权限范围</span>
        <FaSelect
          v-model="draft.targetConfig.permissionCode"
          :options="options.permissions"
          :disabled="!canUpdatePolicy || busy"
          placeholder="选择权限"
        />
      </label>
      <label v-else class="flex flex-col gap-1">
        <span class="qs-type-meta text-muted-foreground">群目标范围</span>
        <FaSelect
          v-model="draft.targetConfig.targetKeys"
          multiple
          :options="options.groups"
          :disabled="!canUpdatePolicy || busy"
          placeholder="选择群目标"
        />
        <span class="qs-type-meta text-muted-foreground">已选 {{ draft.targetConfig.targetKeys.length }} 个群；敏感内容只会发送到「仅内部」群。</span>
      </label>

      <div class="gap-3 grid sm:grid-cols-2">
        <label v-if="channel === 'ASSISTANT'" class="flex flex-col gap-1">
          <span class="qs-type-meta text-muted-foreground">站外 TTL（秒）</span>
          <FaInput
            :model-value="draft.ttlSeconds ?? ''"
            type="number"
            min="60"
            max="604800"
            :disabled="!canUpdatePolicy || busy"
            @update:model-value="updateTtl"
          />
          <span class="qs-type-meta text-muted-foreground">{{ ttlHint }}</span>
        </label>
        <label v-if="channel === 'ASSISTANT'" class="qs-type-meta flex gap-2 items-center sm:pb-6">
          <FaSwitch v-model="draft.allowSensitive" :disabled="!canUpdatePolicy || busy" />
          允许金额/客户名称
        </label>
      </div>

      <div v-if="channel === 'ASSISTANT'" class="flex flex-col gap-2">
        <label class="qs-type-meta flex gap-2 items-center">
          <FaSwitch v-model="draft.quietHoursEnabled" :disabled="!canUpdatePolicy || busy" />
          启用静默时段
        </label>
        <div v-if="draft.quietHoursEnabled" class="gap-2 grid sm:grid-cols-2">
          <label class="flex flex-col gap-1">
            <span class="qs-type-meta text-muted-foreground">开始时间</span>
            <FaInput v-model="draft.quietStart" type="time" :disabled="!canUpdatePolicy || busy" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="qs-type-meta text-muted-foreground">结束时间</span>
            <FaInput v-model="draft.quietEnd" type="time" :disabled="!canUpdatePolicy || busy" />
          </label>
        </div>
        <span v-if="draft.quietHoursEnabled" class="qs-type-meta text-muted-foreground">
          时区固定为 {{ draft.quietTimezone }}；开始时间晚于结束时间表示跨天。
        </span>
      </div>
    </section>

    <EventTemplateBlock
      :channel="channel"
      :event="event"
      :effective="effective"
      :can-view-template="canViewTemplate"
      :can-update-policy="canUpdatePolicy"
      :can-update-template="canUpdateTemplate"
      :busy="busy"
      @pick="emit('pick')"
      @edit="emit('edit', $event)"
      @preview="emit('preview', $event)"
      @create="emit('create', $event)"
      @reset-default="emit('resetDefault')"
    />

    <footer v-if="!isDrawer" class="pt-3 border-t border-border flex flex-wrap gap-2 items-center justify-between">
      <span class="qs-type-meta text-muted-foreground">
        <template v-if="dirty">有未保存的修改</template>
        <template v-else-if="policy !== null">
          更新：{{ policy.updatedByName ?? '—' }} · {{ formatNotificationDateTime(policy.updatedAt) }}
        </template>
        <template v-else>
          新策略默认停用；创建后按右上角开关状态生效
        </template>
      </span>
      <FaButton variant="outline" size="sm" :disabled="!dirty || busy" @click="emit('reset')">
        重置
      </FaButton>
    </footer>
  </article>
</template>
