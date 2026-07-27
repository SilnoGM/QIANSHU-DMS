<script setup lang="ts">
import AppSettingsActions from '@/components/business/AppSettingsPanel/AppSettingsActions.vue'
import AppSettingsPanel from '@/components/business/AppSettingsPanel/index.vue'

defineOptions({
  name: 'SystemApplicationSettings',
})
</script>

<template>
  <div>
    <FaPageHeader
      title="应用配置"
      description="在当前运行环境中预览界面配置；这些调整不会直接写入项目源码。"
    />

    <div class="px-4 lg:px-6">
      <AppSettingsPanel active mode="settings" />

      <div class="mx-auto mt-4 pb-4 max-w-2xl">
        <AppSettingsActions mode="settings" />
      </div>
    </div>
  </div>
</template>
