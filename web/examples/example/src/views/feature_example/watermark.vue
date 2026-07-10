<i18n lang="yaml">
zh-cn:
  description: 在某些场景下，不希望用户将系统里的信息随意截图并转发，这时可开启页面水印，以减少这种情况发生
  update: 更新
  reset: 重置
  tips: 可在 /src/store/modules/app/watermark.ts 文件里定制水印文案内容
zh-tw:
  description: 在某些場景下，不希望用戶將系統里的信息隨意截圖並轉發，這時可開啟頁面水印，以減少這種情況發生
  update: 更新
  reset: 重置
  tips: 可在 /src/store/modules/app/watermark.ts 文件里定制水印文案内容
en:
  description: In some scenarios, it is not desired for users to screenshot and forward information from the system at will. In this case, you can enable page watermarking to reduce the occurrence of such situations.
  update: Update
  reset: Reset
  tips: The watermark text content can be customized in the /src/store/modules/app/watermark.ts file.
</i18n>

<script setup lang="ts">
import dayjs from 'dayjs'

const { t } = useI18n()

const appSettingsStore = useAppSettingsStore()
const appWatermarkStore = useAppWatermarkStore()

const enableWatermark = computed({
  get() {
    return appSettingsStore.settings.app.watermark
  },
  set(newValue) {
    appSettingsStore.$patch((state) => {
      state.settings.app.watermark = newValue
    })
  },
})

function updateWatermark() {
  appWatermarkStore.update({
    content: dayjs().format('YYYY-MM-DD\nHH:mm:ss'),
  })
}
function resetWatermark() {
  appWatermarkStore.update()
}
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.feature.watermark')" :description="t('description')" />
    <FaPageMain main-class="space-y-4">
      <FaSwitch v-model="enableWatermark" />
      <FaButtonGroup v-if="enableWatermark" separator>
        <FaButton @click="updateWatermark">
          {{ t('update') }}
        </FaButton>
        <FaButton @click="resetWatermark">
          {{ t('reset') }}
        </FaButton>
      </FaButtonGroup>
      <p>{{ t('tips') }}</p>
    </FaPageMain>
  </div>
</template>
