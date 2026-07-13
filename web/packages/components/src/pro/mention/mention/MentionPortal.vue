<script setup lang="ts">
const props = defineProps<{
  container?: string | HTMLElement
}>()
</script>

<template>
  <Teleport :to="props.container ?? 'body'">
    <slot />
  </Teleport>
</template>
