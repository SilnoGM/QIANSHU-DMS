<script setup lang="ts">
import RulesPanel from './rules-panel.vue'

defineOptions({ name: 'SystemNotificationPolicies' })
</script>

<template>
  <FaPageHeader
    title="通知策略"
    description="按事件配置投递目标与消息内容，每个渠道单独保存；模板库集中维护跨事件复用的渠道模板。"
  />
  <RulesPanel />
</template>
