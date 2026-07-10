<i18n lang="yaml">
zh-cn:
  description: 在页面离开时，增加弹窗二次确认，避免因误操作导致当前页面数据清空
  enable: 启用
  disable: 禁用
  modal:
    title: 温馨提醒
    content: 当前页面还没有保存，是否确定要离开？
    confirmButtonText: 确定
    cancelButtonText: 取消
zh-tw:
  description: 在頁面離開時，增加彈窗二次確認，避免因誤操作導致當前頁面數據清空
  enable: 启用
  disable: 禁用
  modal:
    title: 温馨提醒
    content: 当前页面还没有保存，是否确定要离开？
    confirmButtonText: 确定
    cancelButtonText: 取消
en:
  description: When leaving the page, add a popup confirmation to avoid clearing the current page data due to incorrect operation.
  enable: Enable
  disable: Disable
  modal:
    title: Warm Reminder
    content: The current page has not been saved, are you sure you want to leave?
    confirmButtonText: Confirm
    cancelButtonText: Cancel
</i18n>

<script setup lang="ts">
const { t } = useI18n()

const tipsSwitch = ref(true)

const FaModal = useFaModal()

onBeforeRouteLeave((_from, _to, next) => {
  if (tipsSwitch.value) {
    FaModal.confirm({
      title: t('modal.title'),
      content: t('modal.content'),
      confirmButtonText: t('modal.confirmButtonText'),
      cancelButtonText: t('modal.cancelButtonText'),
      onConfirm: () => {
        next()
      },
    })
  }
  else {
    next()
  }
})
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.feature.leavetips')" :description="t('description')" />
    <FaPageMain main-class="flex items-center gap-2">
      {{ t('disable') }}
      <FaSwitch v-model="tipsSwitch" />
      {{ t('enable') }}
    </FaPageMain>
  </div>
</template>
