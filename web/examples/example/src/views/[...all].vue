<i18n lang="yaml">
zh-cn:
  notFound: 哎呀，页面不存在
  goBack: 返回首页
zh-tw:
  notFound: 哎呀，頁面不存在
  goBack: 返回首頁
en:
  notFound: Oops, page not found
  goBack: Back to home
</i18n>

<script setup lang="ts">
const { t } = useI18n()

const route = useRoute()
const router = useRouter()

const appSettingsStore = useAppSettingsStore()
const appTabbarStore = useAppTabbarStore()

onMounted(() => {
  if (appSettingsStore.settings.topbar.tabbar) {
    appTabbarStore.remove(route.meta.activeMenu || route.fullPath)
  }
})

function goBack() {
  router.push(appSettingsStore.settings.app.home.fullPath)
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex h-[5vh] lg:h-[10vh]">
      <div class="w-[5vh] lg:w-[10vh]" />
      <div class="border-inline border-dashed flex-1" />
      <div class="w-[5vh] lg:w-[10vh]" />
    </div>
    <div class="border-block border-dashed flex flex-1">
      <div class="w-[5vh] lg:w-[10vh]" />
      <div class="border-inline border-dashed flex-center flex-1 relative">
        <FaPatternBg variant="grid" size="lg" animate direction="top-right" mask="ellipse" :speed="50000" class="op-50 size-full absolute z--1" />
        <div class="p-4 flex-col-center gap-4 lg:p-12">
          <h1 class="text-6xl font-bold m-0 lg:text-9xl">
            404
          </h1>
          <div class="text-xl text-secondary-foreground/50 mx-0 text-center">
            {{ t('notFound') }}
          </div>
          <FaButton variant="link" class="text-unset" @click="goBack">
            {{ t('goBack') }}
          </FaButton>
        </div>
      </div>
      <div class="w-[5vh] lg:w-[10vh]" />
    </div>
    <div class="flex h-[5vh] lg:h-[10vh]">
      <div class="w-[5vh] lg:w-[10vh]" />
      <div class="border-inline border-dashed flex-1" />
      <div class="w-[5vh] lg:w-[10vh]" />
    </div>
  </div>
</template>
