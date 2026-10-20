<script setup lang="ts">
import { useQsToast } from '@/components/base/QsToast/useQsToast'

defineOptions({
  name: 'ToolbarNotification',
})

const toast = useQsToast()

function showNoticePending(): void {
  toast.info('通知功能将在后续版本中上线')
}
</script>

<template>
  <FaButton
    variant="ghost"
    size="icon-sm"
    class="animation"
    aria-label="通知"
    @click="showNoticePending"
  >
    <FaIcon name="i-ri:notification-3-line" class="icon size-4" />
  </FaButton>
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
