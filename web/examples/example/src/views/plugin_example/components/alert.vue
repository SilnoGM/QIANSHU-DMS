<i18n lang="yaml">
zh-cn:
  alert: 框架默认并不包含这些插件，使用前请先安装
zh-tw:
  alert: 框架默认并不包含这些插件，使用前请先安装
en:
  alert: Framework does not include these plugins by default, please install them first before using.
</i18n>

<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <div class="p-4 pb-0 bg-background transition-300">
    <div class="text-sm text-muted-foreground px-4 py-2 rounded-2 bg-muted">
      {{ t('alert') }}
    </div>
  </div>
</template>
