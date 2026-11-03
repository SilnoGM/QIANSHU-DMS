<script setup lang="ts">
import { computed, inject, ref } from 'vue'

import { serverNowEpochMs } from '@/utils/server-clock'
import {
  formatProxyNodeCountdown,
  resolveProxyNodeCountdownClass,
  resolveProxyNodeStatus,
} from './logic'
import { PROXY_NODE_NOW_KEY } from './now'

const props = defineProps<{
  expiresAt: string
}>()

const nowMs = inject(PROXY_NODE_NOW_KEY, ref(serverNowEpochMs()))
const text = computed(() => formatProxyNodeCountdown(props.expiresAt, nowMs.value))
const tone = computed(() => resolveProxyNodeCountdownClass(
  resolveProxyNodeStatus(props.expiresAt, nowMs.value),
))
</script>

<template>
  <span
    class="text-sm font-mono font-semibold px-2.5 py-1 border rounded-md inline-flex gap-1.5 whitespace-nowrap items-center tabular-nums"
    :class="tone"
    aria-live="off"
  >
    <FaIcon name="i-lucide:clock" class="size-3.5" aria-hidden="true" />
    {{ text }}
  </span>
</template>
