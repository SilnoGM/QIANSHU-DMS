<script setup lang="ts">
import type { FundPostingBatchDetailDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'

import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'

import {
  formatFundRateSnapshot,
  getFundAccountTargetLabel,
  getFundAmountStrategyLabel,
  getFundBatchKindLabel,
  getFundBusinessCategoryLabel,
  getFundDirectionState,
  getFundReversalStatusLabel,
} from './fund-transaction.logic'

defineOptions({ name: 'FundBatchDetailDrawer' })

const props = withDefaults(defineProps<{
  canReverse: boolean
  currencies: readonly CurrencyDescriptor[]
  detail: FundPostingBatchDetailDto | null
  error?: null | string
  loading?: boolean
  modelValue: boolean
  requestId?: null | string
}>(), {
  error: null,
  loading: false,
  requestId: null,
})

const emit = defineEmits<{
  'retry': []
  'reverse': [detail: FundPostingBatchDetailDto]
  'update:modelValue': [value: boolean]
}>()

const metadataText = computed(() => {
  if (props.detail === null) {
    return '{}'
  }
  try {
    return JSON.stringify(props.detail.metadata, null, 2)
  }
  catch {
    return '{\n  "error": "业务元数据无法序列化"\n}'
  }
})

function updateVisible(value: boolean): void {
  emit('update:modelValue', value)
}

function reverse(): void {
  if (props.canReverse && props.detail !== null) {
    emit('reverse', props.detail)
  }
}
</script>

<template>
  <QsGenericDrawer
    :model-value="modelValue"
    :title="detail === null ? '资金批次详情' : `资金批次 ${detail.batchNo}`"
    description="查看不可变业务快照、同批次全部账户分录与完整冲账链。"
    size="xl"
    @update:model-value="updateVisible"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:scroll-text" class="size-5" />
    </template>

    <div v-if="loading" class="py-16 flex flex-col gap-3 items-center" role="status">
      <FaIcon name="i-lucide:loader-circle" class="text-primary size-6 animate-spin motion-reduce:animate-none" />
      <span class="qs-type-meta">正在读取批次快照…</span>
    </div>

    <FaAlert
      v-else-if="error"
      variant="destructive"
      icon="i-lucide:circle-alert"
      title="批次详情读取失败"
      class="mb-4"
      role="alert"
    >
      <template #description>
        <div class="gap-2 grid">
          <span>{{ error }}</span>
          <code v-if="requestId" class="qs-type-meta break-all">requestId: {{ requestId }}</code>
        </div>
      </template>
      <template #actions>
        <FaButton variant="outline" size="sm" class="min-h-11 sm:min-h-9" @click="emit('retry')">
          重试
        </FaButton>
      </template>
    </FaAlert>

    <div v-else-if="detail" class="gap-5 grid min-w-0">
      <section aria-labelledby="fund-batch-business-title" class="border border-border/70 bg-card">
        <header class="p-4 border-b border-border/70 flex flex-wrap gap-3 items-start justify-between">
          <div>
            <h2 id="fund-batch-business-title" class="text-sm font-semibold m-0">
              业务基本信息
            </h2>
            <p class="qs-type-meta m-0 mt-1">
              名称与分类均来自动账时保存的历史快照。
            </p>
          </div>
          <div class="flex flex-wrap gap-2 items-center">
            <FaTag variant="outline" class="qs-type-status-tag">
              {{ getFundBatchKindLabel(detail.kind) }}
            </FaTag>
            <FaTag variant="outline" class="qs-type-status-tag">
              {{ getFundReversalStatusLabel(detail.kind === 'REVERSAL' ? 'NOT_APPLICABLE' : detail.reversalChain.status) }}
            </FaTag>
          </div>
        </header>
        <dl class="m-0 p-4 gap-x-6 gap-y-4 grid sm:grid-cols-2 xl:grid-cols-3">
          <div>
            <dt class="qs-type-compact-label mb-1">
              批次号
            </dt>
            <dd class="qs-type-data-emphasis font-mono m-0 break-all">
              {{ detail.batchNo }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              业务类型
            </dt>
            <dd class="m-0">
              <span class="font-medium">{{ detail.postingTypeName }}</span>
              <code class="qs-type-meta mt-1 block break-all">{{ detail.postingTypeCode }}</code>
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              业务分类
            </dt>
            <dd class="m-0">
              <FaTag variant="outline" class="qs-type-status-tag">
                {{ getFundBusinessCategoryLabel(detail.businessCategory) }}
              </FaTag>
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              业务来源
            </dt>
            <dd class="m-0">
              <span>{{ detail.businessSourceName }}</span>
              <code class="qs-type-meta mt-1 block break-all">{{ detail.businessSourceCode }}</code>
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              业务单号
            </dt>
            <dd class="qs-type-data-emphasis font-mono m-0 break-all">
              {{ detail.businessNo ?? '—' }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              业务标识
            </dt>
            <dd class="qs-type-meta font-mono m-0 break-all">
              {{ detail.businessId }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              业务金额
            </dt>
            <dd class="m-0">
              <AmountDisplay :value="detail.businessAmount" :currency="detail.currency" :currencies="currencies" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              业务发生时间
            </dt>
            <dd class="m-0">
              <DateTimeDisplay :value="detail.businessOccurredAt" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              实际入账时间
            </dt>
            <dd class="m-0">
              <DateTimeDisplay :value="detail.postedAt" />
            </dd>
          </div>
          <div class="sm:col-span-2 xl:col-span-3">
            <dt class="qs-type-compact-label mb-1">
              摘要
            </dt>
            <dd class="m-0 break-words">
              {{ detail.summary }}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="fund-batch-rule-title" class="border border-border/70 bg-card">
        <header class="p-4 border-b border-border/70">
          <h2 id="fund-batch-rule-title" class="text-sm font-semibold m-0">
            规则与比例快照
          </h2>
        </header>
        <dl class="m-0 p-4 gap-x-6 gap-y-4 grid sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt class="qs-type-compact-label mb-1">
              规则版本
            </dt>
            <dd class="qs-type-data m-0">
              Revision {{ detail.ruleRevision }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              规则标识
            </dt>
            <dd class="qs-type-meta font-mono m-0 break-all">
              {{ detail.ruleVersionId }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              用户比例
            </dt>
            <dd class="qs-type-data m-0">
              {{ formatFundRateSnapshot(detail.userShareRateSnapshot) }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              公司比例
            </dt>
            <dd class="qs-type-data m-0">
              {{ formatFundRateSnapshot(detail.companyShareRateSnapshot) }}
            </dd>
          </div>
          <div v-if="detail.adjustmentMode">
            <dt class="qs-type-compact-label mb-1">
              调账模式
            </dt>
            <dd class="m-0">
              {{ detail.adjustmentMode === 'USER_ONLY' ? '仅用户账户' : '用户与公司按比例' }}
            </dd>
          </div>
          <div v-if="detail.user">
            <dt class="qs-type-compact-label mb-1">
              关联用户
            </dt>
            <dd class="m-0">
              <QsPersonDisplay :display-name="detail.user.displayName" size="sm" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              请求标识
            </dt>
            <dd class="qs-type-meta font-mono m-0 break-all">
              {{ detail.requestId }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              关联标识
            </dt>
            <dd class="qs-type-meta font-mono m-0 break-all">
              {{ detail.correlationId ?? '—' }}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="fund-batch-entry-title" class="border border-border/70 bg-card">
        <header class="p-4 border-b border-border/70 flex gap-3 items-center justify-between">
          <h2 id="fund-batch-entry-title" class="text-sm font-semibold m-0">
            账户分录
          </h2>
          <span class="qs-type-meta">共 {{ detail.entries.length }} 条</span>
        </header>
        <ol class="m-0 p-4 list-none gap-3 grid">
          <li
            v-for="entry in detail.entries"
            :key="entry.entryId"
            class="p-4 border border-border/70 gap-4 grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1fr)]"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap gap-2 items-center">
                <span class="qs-type-data-emphasis">{{ getFundAccountTargetLabel(entry.accountTarget) }}</span>
                <FaTag variant="outline" class="qs-type-status-tag">
                  第 {{ entry.lineNo }} 行
                </FaTag>
              </div>
              <div class="qs-type-meta mt-1 break-words">
                <QsPersonDisplay
                  v-if="entry.account.user"
                  :display-name="entry.account.user.displayName"
                  size="sm"
                />
                <span v-else>公司资金账户</span>
              </div>
              <code class="qs-type-meta mt-1 block break-all">{{ entry.account.id }}</code>
            </div>
            <div>
              <div class="qs-type-compact-label mb-1">
                方向与金额
              </div>
              <div class="flex flex-wrap gap-2 items-center">
                <span :class="getFundDirectionState(entry.direction).tone === 'debit' ? 'text-destructive' : 'text-primary'" class="font-semibold">
                  {{ getFundDirectionState(entry.direction).sign }} {{ getFundDirectionState(entry.direction).label }}
                </span>
                <AmountDisplay :value="entry.amount" :currency="detail.currency" :currencies="currencies" />
              </div>
              <div class="qs-type-meta mt-1">
                {{ getFundAmountStrategyLabel(entry.amountStrategy) }} · 序号 {{ entry.accountSequence }}
              </div>
            </div>
            <div>
              <div class="qs-type-compact-label mb-1">
                动账前后余额
              </div>
              <div class="gap-1 grid">
                <AmountDisplay :value="entry.balanceBefore" :currency="detail.currency" :currencies="currencies" />
                <span class="qs-type-meta">变更为</span>
                <AmountDisplay :value="entry.balanceAfter" :currency="detail.currency" :currencies="currencies" />
              </div>
            </div>
          </li>
        </ol>
      </section>

      <section aria-labelledby="fund-batch-reversal-title" class="border border-border/70 bg-card">
        <header class="p-4 border-b border-border/70 flex flex-wrap gap-3 items-center justify-between">
          <div>
            <h2 id="fund-batch-reversal-title" class="text-sm font-semibold m-0">
              冲账链
            </h2>
            <p class="qs-type-meta m-0 mt-1">
              原批次不会被修改，以下记录均为新建的反向批次。
            </p>
          </div>
          <FaTag variant="outline" class="qs-type-status-tag">
            {{ getFundReversalStatusLabel(detail.kind === 'REVERSAL' ? 'NOT_APPLICABLE' : detail.reversalChain.status) }}
          </FaTag>
        </header>
        <div class="p-4 gap-4 grid">
          <dl class="m-0 gap-x-6 gap-y-3 grid grid-cols-3 max-[479px]:grid-cols-1">
            <div>
              <dt class="qs-type-compact-label mb-1">
                原始金额
              </dt>
              <dd class="m-0">
                <AmountDisplay :value="detail.reversalChain.originalAmount" :currency="detail.currency" :currencies="currencies" />
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label mb-1">
                累计已冲
              </dt>
              <dd class="m-0">
                <AmountDisplay :value="detail.reversalChain.reversedAmount" :currency="detail.currency" :currencies="currencies" />
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label mb-1">
                剩余额度
              </dt>
              <dd class="m-0">
                <AmountDisplay :value="detail.reversalChain.remainingAmount" :currency="detail.currency" :currencies="currencies" />
              </dd>
            </div>
          </dl>

          <FaEmpty
            v-if="detail.reversalChain.reversals.length === 0"
            icon="i-lucide:rotate-ccw"
            title="尚未发生冲账"
            description="当前批次仍保持原始动账状态。"
            class="py-8"
          />
          <ol v-else class="m-0 list-none gap-3 grid">
            <li v-for="item in detail.reversalChain.reversals" :key="item.batchId" class="p-4 border-l-2 border-destructive bg-muted/20">
              <div class="flex flex-wrap gap-3 items-start justify-between">
                <div>
                  <div class="qs-type-data-emphasis font-mono break-all">
                    {{ item.batchNo }}
                  </div>
                  <p class="m-0 mt-1 break-words">
                    {{ item.reason }}
                  </p>
                </div>
                <AmountDisplay :value="item.amount" :currency="detail.currency" :currencies="currencies" />
              </div>
              <div class="qs-type-meta mt-2 flex flex-wrap gap-3 items-center">
                <DateTimeDisplay :value="item.postedAt" />
                <QsPersonDisplay v-if="item.actorDisplayName" :display-name="item.actorDisplayName" size="sm" />
                <span v-else>—</span>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section aria-labelledby="fund-batch-metadata-title" class="border border-border/70 bg-card">
        <header class="p-4 border-b border-border/70">
          <h2 id="fund-batch-metadata-title" class="text-sm font-semibold m-0">
            业务元数据
          </h2>
        </header>
        <pre class="qs-type-meta m-0 p-4 max-h-72 whitespace-pre-wrap break-words overflow-auto">{{ metadataText }}</pre>
      </section>
    </div>

    <template #footer>
      <FaButton variant="outline" class="min-h-11 w-full sm:min-h-9 sm:w-auto" @click="updateVisible(false)">
        关闭
      </FaButton>
      <FaButton
        v-if="canReverse && detail"
        variant="destructive"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        @click="reverse"
      >
        <FaIcon name="i-lucide:rotate-ccw" />发起冲账
      </FaButton>
    </template>
  </QsGenericDrawer>
</template>
