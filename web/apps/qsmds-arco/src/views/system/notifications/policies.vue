<script setup lang="ts">
import RulesPanel from './rules-panel.vue'

defineOptions({ name: 'SystemNotificationPolicies' })
</script>

<template>
  <FaPageHeader
    title="通知策略"
    description="维护通知模板、事件目标、TTL 与站内/站外渠道策略。"
  />
  <RulesPanel />
</template>
