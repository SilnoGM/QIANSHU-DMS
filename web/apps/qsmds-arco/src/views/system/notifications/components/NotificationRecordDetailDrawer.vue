<script setup lang="ts">
import type { NotificationRecordDetailDto } from '@/api/generated/types.gen'
import { computed, ref, watch } from 'vue'
import { getApiClientFailureMessage } from '@/api/errors'
import notificationsApi from '@/api/modules/notifications'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import QsCopyableText from '@/components/business/QsGenericTable/QsCopyableText.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useAppAuth } from '@/composables/app/auth'
import {
  canCancelRecord,
  deliveryStatusEntries,
  deliveryTotal,
  inAppReadCount,
  sortRecordDeliveries,
} from '../records.logic'
import {
  channelClass,
  channelLabel,
  deliveryStatusClass,
  deliveryStatusLabel,
  domainLabel,
  notificationStatusClass,
  notificationStatusLabel,
  priorityClass,
  priorityLabel,
  sourceTypeLabel,
} from '../records.presentation'

defineOptions({ name: 'NotificationRecordDetailDrawer' })

const props = defineProps<{
  modelValue: boolean
  recordId: string | null
}>()

const emit = defineEmits<{
  'cancel': [record: NotificationRecordDetailDto]
  'update:modelValue': [value: boolean]
}>()

const { auth } = useAppAuth()
const detail = ref<NotificationRecordDetailDto | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
let requestVersion = 0
let controller: AbortController | null = null

const canManage = computed(() => auth('notification-record:manage'))
const canCancel = computed(() => detail.value !== null && canCancelRecord(detail.value, canManage.value))
const deliveries = computed(() => detail.value === null ? [] : sortRecordDeliveries(detail.value.deliveries))
const deliveryStatuses = computed(() => detail.value === null ? [] : deliveryStatusEntries(detail.value))
const assistantTotal = computed(() => detail.value === null ? 0 : deliveryTotal(detail.value.deliveryCounts))
const inAppRead = computed(() => detail.value === null ? 0 : inAppReadCount(detail.value))
const description = computed(() => detail.value === null
  ? '正在读取通知投递明细…'
  : `${detail.value.eventLabel} · ${detail.value.id}`)

async function load(): Promise<void> {
  if (props.recordId === null) {
    detail.value = null
    error.value = null
    loading.value = false
    return
  }

  const version = ++requestVersion
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = null
  detail.value = null
  try {
    const response = await notificationsApi.records.get(props.recordId, controller.signal)
    if (version !== requestVersion) {
      return
    }
    detail.value = response.data
  }
  catch (failure) {
    if (version !== requestVersion || !props.modelValue) {
      return
    }
    error.value = getApiClientFailureMessage(failure, '通知详情加载失败')
  }
  finally {
    if (version === requestVersion) {
      loading.value = false
    }
  }
}

function reload(): Promise<void> {
  return load()
}

function close(): void {
  emit('update:modelValue', false)
}

watch(
  () => [props.modelValue, props.recordId] as const,
  ([open]) => {
    if (!open) {
      requestVersion += 1
      controller?.abort()
      controller = null
      detail.value = null
      error.value = null
      loading.value = false
      return
    }
    void load()
  },
  { immediate: true },
)

defineExpose({ reload })
</script>

<template>
  <QsGenericDrawer
    :model-value="modelValue"
    title="通知详情"
    :description="description"
    size="xl"
    :loading="loading"
    :error="error"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #header-extra>
      <FaTag
        v-if="detail !== null"
        variant="outline"
        class="qs-type-status-tag"
        :class="notificationStatusClass(detail.status)"
      >
        {{ notificationStatusLabel(detail.status) }}
      </FaTag>
    </template>

    <template #error-actions>
      <FaButton variant="outline" size="sm" @click="reload">
        重试
      </FaButton>
    </template>

    <div v-if="detail !== null" class="flex flex-col gap-5">
      <section class="p-4 border border-border rounded-lg bg-muted/15">
        <div class="flex flex-wrap gap-2 items-center">
          <FaTag
            v-for="channel in detail.channels"
            :key="channel"
            variant="outline"
            class="qs-type-status-tag"
            :class="channelClass(channel)"
          >
            {{ channelLabel(channel) }}
          </FaTag>
          <FaTag variant="outline" class="qs-type-status-tag" :class="priorityClass(detail.priority)">
            {{ priorityLabel(detail.priority) }}优先级
          </FaTag>
        </div>
        <p class="qs-type-body-medium m-0 mt-3">
          {{ detail.eventLabel }}
        </p>
        <p class="qs-type-data-emphasis text-muted-foreground m-0 mt-1 break-all">
          {{ detail.eventType }}
        </p>
      </section>

      <section class="flex flex-col gap-3">
        <h3 class="qs-type-body-medium m-0">
          基本信息
        </h3>
        <dl class="gap-3 grid sm:grid-cols-2">
          <div class="min-w-0">
            <dt class="qs-type-compact-label">
              业务域
            </dt>
            <dd class="qs-type-body m-0 mt-1">
              {{ domainLabel(detail.domain) }}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label">
              来源
            </dt>
            <dd class="qs-type-body m-0 mt-1">
              {{ sourceTypeLabel(detail.sourceType) }}
              <span class="text-muted-foreground"> · </span>
              <QsCopyableText label="来源 ID" :text="detail.sourceId" />
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label">
              请求人
            </dt>
            <dd class="qs-type-body m-0 mt-1">
              <QsPersonDisplay v-if="detail.requestedByName !== null" :display-name="detail.requestedByName" size="sm" />
              <span v-else class="text-muted-foreground">—</span>
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label">
              逻辑模板
            </dt>
            <dd class="qs-type-body m-0 mt-1 break-all">
              {{ detail.templateKey }}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label">
              发布时间
            </dt>
            <dd class="m-0 mt-1">
              <DateTimeDisplay :value="detail.publishedAt" />
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label">
              完成时间
            </dt>
            <dd class="m-0 mt-1">
              <DateTimeDisplay :value="detail.completedAt" />
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label">
              过期时间
            </dt>
            <dd class="m-0 mt-1">
              <DateTimeDisplay :value="detail.expiresAt" />
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label">
              记录 ID
            </dt>
            <dd class="qs-type-body m-0 mt-1">
              <QsCopyableText label="记录 ID" :text="detail.id" />
            </dd>
          </div>
        </dl>
      </section>

      <section class="flex flex-col gap-3">
        <h3 class="qs-type-body-medium m-0">
          渠道汇总
        </h3>
        <div class="gap-3 grid sm:grid-cols-2">
          <div v-if="detail.channels.includes('IN_APP')" class="p-4 border border-border rounded-lg">
            <div class="flex gap-2 items-center">
              <FaIcon name="i-lucide:inbox" class="text-sky-600 size-4" />
              <p class="qs-type-body-medium m-0">
                站内通知
              </p>
            </div>
            <dl class="mt-3 gap-3 grid grid-cols-3">
              <div>
                <dt class="qs-type-meta text-muted-foreground">
                  收件
                </dt>
                <dd class="qs-type-data-emphasis m-0">
                  {{ detail.inAppItemCount }}
                </dd>
              </div>
              <div>
                <dt class="qs-type-meta text-muted-foreground">
                  未读
                </dt>
                <dd class="qs-type-data-emphasis m-0">
                  {{ detail.inAppUnreadCount }}
                </dd>
              </div>
              <div>
                <dt class="qs-type-meta text-muted-foreground">
                  已读
                </dt>
                <dd class="qs-type-data-emphasis m-0">
                  {{ inAppRead }}
                </dd>
              </div>
            </dl>
          </div>

          <div v-if="detail.channels.includes('ASSISTANT')" class="p-4 border border-border rounded-lg">
            <div class="flex gap-2 items-center">
              <FaIcon name="i-lucide:send" class="text-primary size-4" />
              <p class="qs-type-body-medium m-0">
                千树小助理
              </p>
            </div>
            <p class="qs-type-data-emphasis m-0 mt-3">
              {{ assistantTotal }} <span class="qs-type-meta text-muted-foreground font-normal">条交付</span>
            </p>
            <div v-if="deliveryStatuses.length > 0" class="mt-2 flex flex-wrap gap-1.5">
              <FaTag
                v-for="item in deliveryStatuses"
                :key="item.status"
                variant="outline"
                class="qs-type-status-tag"
                :class="deliveryStatusClass(item.status)"
              >
                {{ item.label }} {{ item.count }}
              </FaTag>
            </div>
            <p v-else class="qs-type-meta text-muted-foreground m-0 mt-2">
              未生成小助理交付
            </p>
          </div>
        </div>
      </section>

      <section v-if="detail.channels.includes('ASSISTANT')" class="flex flex-col gap-3">
        <div class="flex flex-wrap gap-2 items-baseline justify-between">
          <h3 class="qs-type-body-medium m-0">
            逐人交付
          </h3>
          <span class="qs-type-meta text-muted-foreground">{{ deliveries.length }} 条</span>
        </div>
        <div v-if="deliveries.length > 0" class="flex flex-col gap-2">
          <article
            v-for="delivery in deliveries"
            :key="delivery.id"
            class="p-3 border border-border rounded-lg"
          >
            <div class="flex flex-wrap gap-2 items-center justify-between">
              <div class="min-w-0">
                <QsPersonDisplay
                  v-if="delivery.recipientName !== null"
                  :display-name="delivery.recipientName"
                  size="sm"
                />
                <span v-else-if="delivery.targetName !== null" class="qs-type-body-medium inline-flex gap-1.5 items-center">
                  <FaIcon name="i-lucide:users" class="text-muted-foreground size-4" />
                  {{ delivery.targetName }}
                </span>
                <span v-else class="text-muted-foreground">—</span>
              </div>
              <FaTag
                variant="outline"
                class="qs-type-status-tag"
                :class="deliveryStatusClass(delivery.status)"
              >
                {{ deliveryStatusLabel(delivery.status) }}
              </FaTag>
            </div>
            <div class="qs-type-meta text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1">
              <span>尝试 {{ delivery.attemptCount }} 次</span>
              <span v-if="delivery.acceptedAt !== null">
                接受于 <DateTimeDisplay :value="delivery.acceptedAt" />
              </span>
              <span v-if="delivery.failureCode !== null" class="text-destructive">
                {{ delivery.failureCode }}
              </span>
            </div>
            <p v-if="delivery.templateKey !== detail.templateKey" class="qs-type-meta text-muted-foreground m-0 mt-1 break-all">
              实际模板：{{ delivery.templateKey }}
            </p>
            <p v-if="delivery.failureMessage !== null" class="qs-type-meta text-destructive m-0 mt-1">
              {{ delivery.failureMessage }}
            </p>
          </article>
        </div>
        <FaEmpty
          v-else
          icon="i-lucide:send"
          title="没有小助理交付"
          description="这条通知没有生成小助理交付记录。"
          class="min-h-28"
        />
      </section>

      <p class="qs-type-meta text-muted-foreground m-0 pt-3 border-t border-border">
        “完成”“已接受”表示 GeWe 已接受发送，不代表员工已阅读；站内阅读状态在员工通知中心查看。
      </p>
    </div>

    <template #footer>
      <FaButton variant="outline" @click="close">
        关闭
      </FaButton>
      <FaButton v-if="canCancel" variant="destructive" @click="detail !== null && emit('cancel', detail)">
        取消未发送交付
      </FaButton>
    </template>
  </QsGenericDrawer>
</template>
