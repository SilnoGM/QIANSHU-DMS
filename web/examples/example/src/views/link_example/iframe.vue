<i18n lang="yaml">
zh-cn:
  title: 自定义标题
  titlePlaceholder: 请输入 Iframe 页面的自定义标题，如果不设置，则会显示路由默认的标题
  iframePlaceholder: 请输入 Iframe 页面的链接
  invalid: 请输入正确的链接
zh-tw:
  title: 自定义标题
  titlePlaceholder: 請輸入 Iframe 頁面的自定義標題，如果不設置，則會顯示路由默認的標題
  iframePlaceholder: 請輸入 Iframe 頁面的連結
  invalid: 請輸入正確的連結
en:
  title: Custom Title
  titlePlaceholder: Please enter the custom title of the Iframe page, if not set, the default title of the route will be displayed
  iframePlaceholder: Please enter the link of the Iframe page
  invalid: Please enter the correct link
</i18n>

<script setup lang="ts">
defineOptions({
  name: 'LinkExampleIframe',
})

const { t } = useI18n()

const router = useRouter()

const data = ref({
  title: t('title'),
  iframe: 'https://fantastic-admin.hurui.me/',
})

function open() {
  if (/^https?:\/\//.test(data.value.iframe)) {
    router.push({
      name: 'linkExampleIframeDynamicTest',
      query: {
        title: data.value.title,
        iframe: data.value.iframe,
      },
    })
  }
  else {
    useFaToast().error(t('invalid'))
  }
}
</script>

<template>
  <FaPageMain main-class="space-y-2">
    <FaInput v-model="data.title" class="w-full" placeholder="请输入 Iframe 页面的自定义标题，如果不设置，则会显示路由默认的标题" />
    <FaButtonGroup class="w-full">
      <FaInput v-model="data.iframe" class="w-full" placeholder="请输入 Iframe 页面的链接" />
      <FaButton @click="open">
        GO!
      </FaButton>
    </FaButtonGroup>
  </FaPageMain>
</template>
