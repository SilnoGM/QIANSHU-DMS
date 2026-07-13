<i18n lang="yaml">
zh-cn:
  buttonText: 查看详情页
zh-tw:
  buttonText: 查看詳情頁
en:
  buttonText: View Details
</i18n>

<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <FaPageMain>
    <RouterLink v-slot="{ navigate }" :to="{ name: 'breadcrumbExampleDetail1' }" custom>
      <FaButton @click="navigate">
        {{ t('buttonText') }}
      </FaButton>
    </RouterLink>
  </FaPageMain>
</template>
