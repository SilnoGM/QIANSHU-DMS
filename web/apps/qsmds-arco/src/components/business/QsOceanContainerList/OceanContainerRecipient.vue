<script setup lang="ts">
import type { OceanContainerLine } from './types'

defineProps<{ line: OceanContainerLine }>()
const { t } = useI18n()
</script>

<template>
  <FaTooltip align="center" :disabled="!line.recipientName && !line.recipientPhone && !line.recipientAddress">
    <span class="align-middle max-w-full inline-block truncate" tabindex="0">{{ line.recipientName || '—' }}</span>
    <template #content>
      <dl class="m-0 text-left max-w-[min(22rem,calc(100vw-3rem))] [overflow-wrap:anywhere] space-y-1">
        <div v-for="field in (['recipientName', 'recipientPhone', 'recipientAddress'] as const)" :key="field">
          <dt class="inline">
            {{ t(`qsOceanContainer.${field}`) }}：
          </dt>
          <dd class="m-0 inline whitespace-pre-wrap">
            {{ line[field] || '—' }}
          </dd>
        </div>
      </dl>
    </template>
  </FaTooltip>
</template>
