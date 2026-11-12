<script setup lang="ts">
import AssistantPanel from './assistant-panel.vue'
import ChannelSwitch from './channel-switch.vue'

defineOptions({ name: 'SystemNotificationAssistant' })
</script>

<template>
  <FaPageHeader
    title="GeWe助理"
    description="管理 GeWe 公司号、员工绑定、群目标与渠道状态。登录、重连和退出仍在 GeWe 控制台完成。"
  >
    <ChannelSwitch />
  </FaPageHeader>
  <AssistantPanel />
</template>
