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
    class="text-base font-mono font-semibold whitespace-nowrap tabular-nums"
    :class="tone"
    aria-live="off"
  >
    {{ text }}
  </span>
</template>
