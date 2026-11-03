<script setup lang="ts">
import { computed, inject, ref } from 'vue'

import { serverNowEpochMs } from '@/utils/server-clock'
import {
  resolveProxyNodeStatus,
  resolveProxyNodeStatusClass,
  resolveProxyNodeStatusLabel,
} from './logic'
import { PROXY_NODE_NOW_KEY } from './now'

const props = defineProps<{
  expiresAt: string
}>()

const nowMs = inject(PROXY_NODE_NOW_KEY, ref(serverNowEpochMs()))
const status = computed(() => resolveProxyNodeStatus(props.expiresAt, nowMs.value))
const label = computed(() => resolveProxyNodeStatusLabel(status.value))
const statusClass = computed(() => resolveProxyNodeStatusClass(status.value))
</script>

<template>
  <FaTag
    variant="outline"
    class="qs-type-status-tag inline-flex gap-1.5 whitespace-nowrap items-center"
    :class="statusClass"
  >
    <span class="rounded-full bg-current size-1.5" aria-hidden="true" />
    {{ label }}
  </FaTag>
</template>
