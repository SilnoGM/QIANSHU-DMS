<script setup lang="ts">
import type { PreviewNumberingRuleResponseDto } from '@/api/generated/types.gen'

import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'

import {
  formatNumberingDecimal,
  numberingPeriodStatusLabel,
} from './numbering-management.logic'

defineOptions({ name: 'NumberingRulePreview' })

withDefaults(defineProps<{
  error?: null | string
  loading?: boolean
  preview?: null | PreviewNumberingRuleResponseDto
  requestId?: null | string
}>(), {
  error: null,
  loading: false,
  preview: null,
  requestId: null,
})
</script>

<template>
  <section
    class="p-4 border border-border rounded-lg bg-muted/25 min-w-0"
    aria-labelledby="numbering-preview-title"
    :aria-busy="loading"
  >
    <div class="mb-4 flex flex-wrap gap-3 items-start justify-between">
      <div class="min-w-0">
        <h3
          id="numbering-preview-title"
          data-testid="numbering-preview-title"
          class="qs-type-section-title m-0"
        >
          Server 规则预览
        </h3>
        <p class="qs-type-description mb-0 mt-1">
          样例、容量与下一编号均由 Server 按 Asia/Shanghai 计算。
        </p>
      </div>
      <FaTag v-if="preview" variant="outline" class="qs-type-status-tag">
        {{ numberingPeriodStatusLabel(preview.periodStatus) }}
      </FaTag>
    </div>

    <FaAlert
      v-if="error"
      class="mb-4"
      icon="i-lucide:circle-alert"
      title="预览失败"
      variant="destructive"
      role="alert"
    >
      <template #description>
        <div class="gap-2 grid">
          <span>{{ error }}</span>
          <code v-if="requestId" class="qs-type-meta break-all">
            requestId: {{ requestId }}
          </code>
        </div>
      </template>
    </FaAlert>

    <div v-if="loading" class="gap-3 grid" role="status" aria-live="polite">
      <div class="rounded-md bg-muted h-14 animate-pulse" aria-hidden="true" />
      <div class="gap-3 grid grid-cols-2 sm:grid-cols-4" aria-hidden="true">
        <div v-for="index in 4" :key="index" class="rounded-md bg-muted h-16 animate-pulse" />
      </div>
      <span class="sr-only">正在计算编号预览</span>
    </div>

    <FaEmpty
      v-else-if="preview === null"
      icon="i-lucide:scan-text"
      title="等待有效配置"
      description="调整表单后将自动请求 Server 预览。"
      class="min-h-36"
    />

    <div v-else class="gap-5 grid min-w-0">
      <div>
        <p class="qs-type-compact-label mb-2 mt-0">
          编号样例
        </p>
        <ul class="m-0 p-0 list-none flex flex-wrap gap-2">
          <li v-for="sample in preview.samples" :key="sample" class="min-w-0">
            <code
              class="qs-type-data-emphasis px-2.5 py-1.5 border border-border rounded-md bg-background block whitespace-normal [overflow-wrap:anywhere]"
            >
              {{ sample }}
            </code>
          </li>
        </ul>
      </div>

      <dl class="m-0 gap-3 grid grid-cols-2 sm:grid-cols-4">
        <div class="p-3 border border-border rounded-md bg-background min-w-0">
          <dt class="qs-type-compact-label mb-1">
            周期容量
          </dt>
          <dd class="qs-type-data-emphasis m-0 [overflow-wrap:anywhere] tabular-nums">
            {{ formatNumberingDecimal(preview.capacity) }}
          </dd>
        </div>
        <div class="p-3 border border-border rounded-md bg-background min-w-0">
          <dt class="qs-type-compact-label mb-1">
            已使用
          </dt>
          <dd class="qs-type-data m-0 [overflow-wrap:anywhere] tabular-nums">
            {{ formatNumberingDecimal(preview.usedCount) }}
          </dd>
        </div>
        <div class="p-3 border border-border rounded-md bg-background min-w-0">
          <dt class="qs-type-compact-label mb-1">
            剩余
          </dt>
          <dd class="qs-type-data-emphasis m-0 [overflow-wrap:anywhere] tabular-nums">
            {{ formatNumberingDecimal(preview.remainingCount) }}
          </dd>
        </div>
        <div class="p-3 border border-border rounded-md bg-background min-w-0">
          <dt class="qs-type-compact-label mb-1">
            下一序列值
          </dt>
          <dd class="qs-type-data m-0 [overflow-wrap:anywhere] tabular-nums">
            {{ preview.nextSequenceValue === null
              ? '—'
              : formatNumberingDecimal(preview.nextSequenceValue) }}
          </dd>
        </div>
      </dl>

      <div class="p-3 border border-border rounded-md bg-background min-w-0">
        <p class="qs-type-compact-label mb-1 mt-0">
          下一编号
        </p>
        <code class="qs-type-data-emphasis block whitespace-normal [overflow-wrap:anywhere]">
          {{ preview.nextNumberPreview ?? '当前配置不提供确定下一编号' }}
        </code>
        <p class="qs-type-meta mb-0 mt-1">
          {{ preview.nextNumberDeterministic ? '确定预览' : '随机样例，实际发号结果可能不同' }}
          · 周期 {{ preview.periodKey }}
        </p>
      </div>

      <div class="qs-type-meta flex flex-wrap gap-x-4 gap-y-1 items-center">
        <span>固定时区 · <code>{{ preview.normalizedConfig.timezone }}</code></span>
        <span>最长 {{ preview.normalizedConfig.maxOutputLength }} 位</span>
        <span class="flex gap-1 items-center">
          统计时间 ·
          <DateTimeDisplay :value="preview.asOf" time-zone="Asia/Shanghai" />
        </span>
      </div>
    </div>
  </section>
</template>
