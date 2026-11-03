<script setup lang="ts">
import type { ProxyNodeCardMode } from './logic'

import { computed, inject, ref } from 'vue'
import { serverNowEpochMs } from '@/utils/server-clock'
import {
  resolveProxyNodeStatus,
  resolveProxyNodeWarning,
  resolveProxyNodeWarningClass,
} from './logic'
import { PROXY_NODE_NOW_KEY } from './now'

const props = defineProps<{
  expiresAt: string
  mode: ProxyNodeCardMode
}>()

const nowMs = inject(PROXY_NODE_NOW_KEY, ref(serverNowEpochMs()))
const status = computed(() => resolveProxyNodeStatus(props.expiresAt, nowMs.value))
const warning = computed(() => resolveProxyNodeWarning(status.value, props.mode))
const warningClass = computed(() => resolveProxyNodeWarningClass(status.value))
</script>

<template>
  <span v-if="warning" class="text-xs" :class="warningClass">
    {{ warning }}
  </span>
</template>
