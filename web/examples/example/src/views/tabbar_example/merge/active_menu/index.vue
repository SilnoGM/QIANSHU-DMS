<i18n lang="yaml">
zh-cn:
  description: 基于「激活菜单」合并标签页
  button1: 打开详情页1
  button2: 打开详情页2
zh-tw:
  description: 基於「激活菜單」合併標籤頁
  button1: 開啟詳情頁1
  button2: 開啟詳情頁2
en:
  description: Based on the "active menu" merge tabbar
  button1: Open Detail Page 1
  button2: Open Detail Page 2
</i18n>

<script setup lang="ts">
const { t } = useI18n()

const router = useRouter()

function open(id: number) {
  router.push({
    name: 'tabbarExampleMergeActiveMenuDetail',
    params: {
      id,
    },
  })
}
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.tabbar.merge')" :description="t('description')" />
    <FaPageMain main-class="flex gap-2">
      <FaButton @click="open(1)">
        {{ t('button1') }}
      </FaButton>
      <FaButton @click="open(2)">
        {{ t('button2') }}
      </FaButton>
    </FaPageMain>
  </div>
</template>
