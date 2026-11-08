<script setup lang="ts">
defineOptions({
  name: 'ToolbarNotification',
})

const Panel = defineAsyncComponent(() => import('./panel.vue'))
const store = useAppNotificationStore()
const open = ref(false)

onMounted(() => {
  store.startPolling()
})

onBeforeUnmount(() => {
  store.stopPolling()
})
</script>

<template>
  <FaPopover v-model:open="open" class="p-0">
    <FaButton variant="ghost" size="icon-sm" class="animation" aria-label="通知">
      <FaBadge
        v-if="store.unreadTotal > 0"
        :value="store.unreadTotal > 99 ? '99+' : store.unreadTotal"
        variant="destructive"
        badge-class="scale-80"
      >
        <FaIcon name="i-ri:notification-3-line" class="icon size-4" />
      </FaBadge>
      <FaIcon v-else name="i-ri:notification-3-line" class="icon size-4" />
    </FaButton>
    <template #panel>
      <Panel v-if="open" @close="open = false" />
    </template>
  </FaPopover>
</template>

<style scoped>
.animation {
  .icon {
    transform-origin: center top;
  }

  &:hover .icon {
    animation: animation 1s;
  }
}

@keyframes animation {
  20% {
    transform: rotate3d(0, 0, 1, 15deg);
  }

  40% {
    transform: rotate3d(0, 0, 1, -10deg);
  }

  60% {
    transform: rotate3d(0, 0, 1, 5deg);
  }

  80% {
    transform: rotate3d(0, 0, 1, -5deg);
  }

  100% {
    transform: rotate3d(0, 0, 1, 0deg);
  }
}
</style>
