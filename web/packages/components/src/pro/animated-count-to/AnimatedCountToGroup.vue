<script setup lang="ts">
import { NumberFlowGroup } from '@number-flow/vue'

defineOptions({
  name: 'BuiltInAnimatedCountToGroup',
})
</script>

<template>
  <NumberFlowGroup>
    <slot />
  </NumberFlowGroup>
</template>
