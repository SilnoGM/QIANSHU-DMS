<script setup lang="ts">
import type { NotificationChannelValue, PolicyOptionLists } from '../event-config.logic'
import type { PolicyDraft } from '../policy-draft.logic'
import type {
  AssistantTargetDto,
  NotificationChannelPolicyDto,
  NotificationEventDto,
  NotificationTemplateDto,
  PermissionDto,
  RoleDto,
  UserDto,
} from '@/api/generated/types.gen'

import { computed, ref, watch } from 'vue'
import { getApiClientFailureMessage } from '@/api/errors'
import managementApi from '@/api/modules/management'
import notificationsApi from '@/api/modules/notifications'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { resolveChannelTemplate } from '../event-config.logic'
import {
  buildPolicyUpdate,
  canSavePolicyDraft,
  createPolicyDraft,
  policyDraftSignature,
} from '../policy-draft.logic'
import EventChannelCard from './EventChannelCard.vue'
import TemplatePickerDrawer from './TemplatePickerDrawer.vue'

const props = defineProps<{
  busy: boolean
  canUpdatePolicy: boolean
  canUpdateTemplate: boolean
  canViewTemplate: boolean
  channel: NotificationChannelValue
  event: NotificationEventDto
  policy: NotificationChannelPolicyDto | null
  templates: readonly NotificationTemplateDto[] | null
  usage: ReadonlyMap<string, Set<string>>
}>()

const emit = defineEmits<{
  createTemplate: [payload: { eventType: string, channel: NotificationChannelValue, key: string }]
  editTemplate: [template: NotificationTemplateDto]
  previewTemplate: [template: NotificationTemplateDto]
  saved: [policy: NotificationChannelPolicyDto]
}>()

const open = defineModel<boolean>('modelValue', { required: true })

const toast = useQsToast()
const draft = ref<PolicyDraft>(createPolicyDraft(null, props.channel))
const baseline = ref('')
const saving = ref(false)
const discardOpen = ref(false)
const pickerOpen = ref(false)

const users = ref<UserDto[]>([])
const roles = ref<RoleDto[]>([])
const permissions = ref<PermissionDto[]>([])
const targets = ref<AssistantTargetDto[]>([])
const optionsLoading = ref(false)
const optionsLoaded = ref(false)

const channelLabel = computed(() => props.channel === 'ASSISTANT' ? '千树小助理' : '站内通知')
const options = computed<PolicyOptionLists>(() => ({
  users: users.value.map(user => ({ label: `${user.displayName}（${user.username}）`, value: user.id })),
  roles: roles.value.map(role => ({ label: `${role.name}（${role.code}）`, value: role.code })),
  permissions: permissions.value.map(permission => ({ label: `${permission.name}（${permission.code}）`, value: permission.code })),
  groups: targets.value.map(target => ({ label: `${target.name}（${target.key}）`, value: target.key })),
}))

const dirty = computed(() => baseline.value.length > 0
  && policyDraftSignature(draft.value) !== baseline.value)
const canSave = computed(() => (props.policy === null || dirty.value)
  && canSavePolicyDraft(draft.value, props.channel, props.canUpdatePolicy))

const effective = computed(() => {
  const draftPolicy: NotificationChannelPolicyDto = props.policy === null
    ? {
        id: `draft-${props.event.eventType}-${props.channel}`,
        eventType: props.event.eventType,
        channel: props.channel,
        targetMode: draft.value.targetMode,
        targetConfig: {},
        templateKey: draft.value.templateKey.trim() || null,
        priority: draft.value.priority,
        ttlSeconds: draft.value.ttlSeconds,
        quietHours: null,
        allowSensitive: draft.value.allowSensitive,
        enabled: draft.value.enabled,
        version: 0,
        updatedAt: '',
        updatedByName: null,
      }
    : {
        ...props.policy,
        templateKey: draft.value.templateKey.trim() || null,
        enabled: draft.value.enabled,
      }
  return resolveChannelTemplate(props.event, props.channel, draftPolicy, props.templates)
})

function resetDraft(): void {
  draft.value = createPolicyDraft(props.policy, props.channel)
  baseline.value = policyDraftSignature(draft.value)
}

watch(
  [open, () => props.event.eventType, () => props.channel],
  ([isOpen]) => {
    if (!isOpen) {
      return
    }
    resetDraft()
    if (draft.value.targetMode !== 'COMMAND_TARGET') {
      void ensureOptions()
    }
  },
  { immediate: true },
)

watch(
  () => draft.value.targetMode,
  (mode) => {
    if (open.value && mode !== 'COMMAND_TARGET') {
      void ensureOptions()
    }
  },
)

async function ensureOptions(): Promise<void> {
  if (optionsLoaded.value || optionsLoading.value) {
    return
  }
  optionsLoading.value = true
  const signal = new AbortController().signal
  const [userResult, roleResult, permissionResult, targetResult] = await Promise.allSettled([
    managementApi.users.list({ page: 1, pageSize: 100, status: 'ACTIVE' }, signal),
    managementApi.roles.list(),
    managementApi.permissions.list(),
    notificationsApi.assistant.targets.list(signal),
  ])
  if (userResult.status === 'fulfilled') {
    users.value = userResult.value.data.items
  }
  if (roleResult.status === 'fulfilled') {
    roles.value = roleResult.value.data
  }
  if (permissionResult.status === 'fulfilled') {
    permissions.value = permissionResult.value.data
  }
  if (targetResult.status === 'fulfilled') {
    targets.value = targetResult.value.data
  }
  optionsLoaded.value = true
  optionsLoading.value = false
}

async function save(): Promise<void> {
  saving.value = true
  try {
    const updated = (await notificationsApi.policies.update(
      props.event.eventType,
      props.channel,
      buildPolicyUpdate(draft.value, props.channel),
    )).data
    draft.value.expectedVersion = updated.version
    baseline.value = policyDraftSignature(draft.value)
    emit('saved', updated)
    toast.success('事件策略已保存')
    open.value = false
  }
  catch (failure) {
    toast.error(getApiClientFailureMessage(failure, '事件策略保存失败'))
  }
  finally {
    saving.value = false
  }
}

function reset(): void {
  resetDraft()
}

async function canClose(): Promise<boolean> {
  if (!dirty.value) {
    return true
  }
  discardOpen.value = true
  return false
}

function confirmDiscard(): void {
  baseline.value = policyDraftSignature(draft.value)
  discardOpen.value = false
  open.value = false
}

function cancelDiscard(): void {
  discardOpen.value = false
}

function pickTemplate(): void {
  pickerOpen.value = true
}

function selectTemplate(key: string): void {
  draft.value.templateKey = key
}

function createTemplate(key: string): void {
  emit('createTemplate', {
    eventType: props.event.eventType,
    channel: props.channel,
    key,
  })
  pickerOpen.value = false
}

function resetDefaultTemplate(): void {
  draft.value.templateKey = ''
}

defineExpose({
  hasDirty: () => dirty.value,
  discard: () => {
    discardOpen.value = false
    resetDraft()
    open.value = false
  },
})
</script>

<template>
  <QsGenericDrawer
    v-model="open"
    :title="`${event.label} · ${channelLabel}`"
    description="配置该渠道的投递目标与消息内容；保存后按启用状态投递。"
    size="lg"
    :submitting="saving"
    :before-close="canClose"
  >
    <EventChannelCard
      v-model:draft="draft"
      variant="drawer"
      :channel="channel"
      :event="event"
      :policy="policy"
      :effective="effective"
      :dirty="dirty"
      :options="options"
      :busy="busy || saving || optionsLoading"
      :can-update-policy="canUpdatePolicy"
      :can-update-template="canUpdateTemplate"
      :can-view-template="canViewTemplate"
      @pick="pickTemplate"
      @edit="emit('editTemplate', $event)"
      @preview="emit('previewTemplate', $event)"
      @create="emit('createTemplate', { eventType: event.eventType, channel, key: $event })"
      @reset-default="resetDefaultTemplate"
    />

    <template #footer>
      <div class="flex flex-wrap gap-2 w-full items-center justify-between">
        <span class="qs-type-meta text-muted-foreground">
          <template v-if="dirty">有未保存的修改</template>
          <template v-else-if="policy !== null">
            更新：{{ policy.updatedByName ?? '—' }}
          </template>
          <template v-else>
            新策略默认停用；保存后按启用开关生效
          </template>
        </span>
        <div class="flex gap-2">
          <FaButton variant="outline" :disabled="!dirty || saving" @click="reset">
            重置
          </FaButton>
          <FaButton :loading="saving" :disabled="!canSave || busy" @click="save">
            {{ policy === null ? '创建策略' : '保存' }}
          </FaButton>
        </div>
      </div>
    </template>

    <TemplatePickerDrawer
      v-if="templates !== null"
      v-model:open="pickerOpen"
      :channel="channel"
      :event="event"
      :selected-key="draft.templateKey.trim() || null"
      :templates="templates"
      :usage="usage"
      :can-update-policy="canUpdatePolicy"
      :can-update-template="canUpdateTemplate"
      :busy="busy || saving"
      @select="selectTemplate"
      @create="createTemplate"
      @preview="emit('previewTemplate', $event)"
    />

    <QsGenericModal v-model="discardOpen" title="放弃修改" size="sm" :z-index="2200" @update:model-value="cancelDiscard">
      <p class="qs-type-body m-0">
        当前渠道有未保存的修改，关闭后这些修改会丢失。
      </p>
      <template #footer>
        <FaButton variant="outline" @click="cancelDiscard">
          继续编辑
        </FaButton>
        <FaButton variant="destructive" @click="confirmDiscard">
          放弃修改
        </FaButton>
      </template>
    </QsGenericModal>
  </QsGenericDrawer>
</template>
