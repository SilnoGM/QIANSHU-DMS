<i18n lang="yaml">
zh-cn:
  modal: 在模态框中
zh-tw:
  modal: 在模態框中
en:
  modal: In modal
</i18n>

<script setup lang="ts">
const { t } = useI18n()

const dialogVisible = ref(false)
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.feature.zoomable')" />
    <FaPageMain>
      <img v-zoomable class="h-20 w-20 block" src="https://fantastic-admin.hurui.me/logo.svg">
    </FaPageMain>
    <FaPageMain>
      <FaButton @click="dialogVisible = true">
        {{ t('modal') }}
      </FaButton>
      <FaModal v-model="dialogVisible" :header="false" :footer="false" content-class="min-h-auto">
        <img v-zoomable class="h-20 w-20 block" src="https://fantastic-admin.hurui.me/logo.svg">
      </FaModal>
    </FaPageMain>
  </div>
</template>
