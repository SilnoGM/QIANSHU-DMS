<script setup lang="ts">
import { isMockDataEnabled } from '@/api/mock-mode'
import Panel from './panel.vue'

defineOptions({
  name: 'ToolbarNotification',
})

const appNotificationStore = useAppNotificationStore()

// 通知数据只有 mock 来源；没有 mock 服务时不得发起请求，否则会打到不存在的 /fake/* 并报错。
if (isMockDataEnabled) {
  appNotificationStore.init()
}
</script>

<template>
  <FaPopover class="p-0">
    <FaButton variant="ghost" size="icon-sm" class="animation">
      <FaBadge :value="appNotificationStore.total > 9 ? true : appNotificationStore.total">
        <FaIcon name="i-ri:notification-3-line" class="icon size-4" />
      </FaBadge>
    </FaButton>
    <template #panel>
      <Panel />
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
