<i18n lang="yaml">
zh-cn:
  description: 基于 v-wave 实现，更多设置请查看官方文档
zh-tw:
  description: 基于 v-wave 實現，更多設置請查看官方文檔
en:
  description: Based on v-wave, more settings please see the official document
</i18n>

<script setup lang="ts">
const { t } = useI18n()

const input = ref('')

function open(url: string) {
  window.open(url, '_blank')
}
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.feature.waves')" :description="t('description')">
      <FaButton variant="outline" size="icon" @click="open('https://github.com/justintaddei/v-wave')">
        <FaIcon name="i-simple-icons:github" />
      </FaButton>
    </FaPageHeader>
    <FaPageMain>
      <div class="space-x-2">
        <FaButton v-wave>
          Button
        </FaButton>
        <FaButton v-wave variant="destructive">
          Button
        </FaButton>
        <FaButton v-wave variant="outline">
          Button
        </FaButton>
        <FaButton v-wave variant="secondary">
          Button
        </FaButton>
        <FaButton v-wave variant="ghost">
          Button
        </FaButton>
        <FaButton v-wave variant="link">
          Button
        </FaButton>
      </div>
      <div
        v-wave="{
          color: '#f00',
          finalOpacity: 0.3,
        }" class="my-4 border flex-center h-25 w-25"
      >
        Colors
      </div>
      <FaInput v-model="input" v-wave>
        <template #end>
          <FaButton v-wave-trigger variant="ghost" size="icon" class="size-6">
            <FaIcon name="i-ri:search-line" />
          </FaButton>
        </template>
      </FaInput>
    </FaPageMain>
  </div>
</template>
