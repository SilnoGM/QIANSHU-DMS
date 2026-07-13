<i18n lang="yaml">
zh-cn:
  description: 除了支持全局多语言切换，还支持 Vue 单文件模式语言切换，你可以尝试在这个页面点击右上角的语言切换试试
  load:
    dynamic: 动态加载
    zh: 载入中文
    en: 载入英文
    success: 载入成功，你可以切换语言查看效果
zh-tw:
  description: 除了支持全局多語言切換，還支持 Vue 單文件模式語言切換，你可以嘗試在這個頁面點擊右上角的語言切換試試
  load:
    dynamic: 動態載入
    zh: 載入中文
    en: 載入英文
    success: 載入成功，你可以切換語言查看效果
en:
  description: In addition to global multi-language switch, also support Vue single file mode language switch, you can try to click on the top right corner of the page to switch language
  load:
    dynamic: Dynamic loading
    zh: Load Chinese
    en: Load English
    success: Load successful, you can switch languages to see the effect.
</i18n>

<script setup lang="ts">
import { i18n, localesInfo } from '@/locales'
import dayjs from '@/utils/dayjs'

const { t } = useI18n()
const appSettingsStore = useAppSettingsStore()

const monthWeek = ref('')
watch(() => appSettingsStore.lang, () => {
  monthWeek.value = dayjs().format('MMMM-dddd')
}, {
  immediate: true,
})

function lazyload(lang: string) {
  if (!localesInfo[lang]) {
    return
  }
  const localeMessage = i18n.global.getLocaleMessage(lang)
  // 模拟异步载入，新增的语言包数据需要和框架默认数据合并
  i18n.global.setLocaleMessage(lang, {
    ...localeMessage,
    hello: {
      world: lang === 'zh-cn' ? '你好，世界！' : 'Hello World !',
    },
  })
  useFaToast().success(t('load.success'))
}
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.feature.i18n')" :description="t('description')" />
    <FaPageMain title="Dayjs">
      {{ monthWeek }}
    </FaPageMain>
    <FaPageMain :title="t('load.dynamic')">
      <div class="space-x-2">
        <FaButton @click="lazyload('zh-cn')">
          {{ t('load.zh') }}
        </FaButton>
        <FaButton @click="lazyload('en')">
          {{ t('load.en') }}
        </FaButton>
      </div>
      <p>
        <!-- eslint-disable-next-line @intlify/vue-i18n/no-missing-keys -->
        {{ t('hello.world') }}
      </p>
    </FaPageMain>
  </div>
</template>
