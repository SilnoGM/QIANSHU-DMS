<i18n lang="yaml">
zh-cn:
  description: 当前路由需开启页面保活。你可以滚动当前页，然后跳转到其它页面，再回来时会自动定位到离开时的滚动位置
zh-tw:
  description: 當前路由需開啟頁面保活。你可以滾動當前頁，然後跳轉到其他頁面，再回來時會自動定位到離開時的滾動位置
en:
  description: The current route needs to enable page keep-alive. You can scroll the current page, then jump to other pages, and when you come back, it will automatically locate to the scroll position when you left
</i18n>

<script setup lang="ts">
defineOptions({
  name: 'FeatureExampleScroll',
})

const { t } = useI18n()

const scrollTop = ref(0)

// 激活时定位到之前的滚动位置
onActivated(() => {
  nextTick(() => {
    document.documentElement.scrollTop = scrollTop.value
  })
})

// 离开时记录当前页面滚动位置
onBeforeRouteLeave((_to, _from, next) => {
  scrollTop.value = document.documentElement.scrollTop
  next()
})
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.feature.scroll')" :description="t('description')" />
    <FaPageMain main-class="space-y-2">
      <div v-for="i in 100" :key="i" class="p-4 border flex-center">
        {{ i }}
      </div>
    </FaPageMain>
  </div>
</template>
