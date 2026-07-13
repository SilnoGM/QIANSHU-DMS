<script setup lang="ts">
defineOptions({
  name: 'IframeView',
})

const route = useRoute()

const appSettingsStore = useAppSettingsStore()
const appIframeStore = useAppIframeStore()
const { setCustomTitle } = useAppPage()
const { generateI18nTitle } = useAppMenu()

const iframeRef = useTemplateRef<HTMLIFrameElement[]>('iframeRef')

watch(() => route.fullPath, (val) => {
  nextTick(() => {
    iframeRef.value?.forEach((item: HTMLIFrameElement) => {
      if (item.dataset.path === val) {
        const title = appIframeStore.openedList.find(i => i.path === val)?.title
        title && setCustomTitle(generateI18nTitle(title))
        item.onload = () => {
          appIframeStore.closeLoading(val)
        }
      }
    })
  })
}, {
  immediate: true,
})
</script>

<template>
  <div class="iframe-view flex flex-col h-full w-full left-0 top-0 absolute">
    <div v-for="item in appIframeStore.openedList" :key="item.path" class="flex flex-col h-full w-full left-0 top-0 absolute" :class="{ 'z-1': route.fullPath === item.path }">
      <Transition :name="appSettingsStore.settings.page.transitionMode" mode="out-in" appear>
        <iframe v-show="route.fullPath === item.path" ref="iframeRef" :data-path="item.path" :src="item.src" frameborder="0" class="flex-1 h-full w-full" />
      </Transition>
      <div v-show="item.isLoading" class="bg-popover/75 flex-center h-full w-full left-0 top-0 absolute">
        <FaIcon name="i-line-md:loading-twotone-loop" class="size-10" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.slide-left-enter-active,
.slide-right-enter-active,
.slide-top-enter-active,
.slide-bottom-enter-active {
  transition: 0.4s;
}

.fade-leave-active,
.slide-left-leave-active,
.slide-right-leave-active,
.slide-top-leave-active,
.slide-bottom-leave-active {
  transition: 0.3s;
}

.fade-enter-from {
  opacity: 0;
}

.fade-leave-to {
  opacity: 0;
}

.slide-left-enter-from {
  margin-left: 20px;
  opacity: 0;
}

.slide-left-leave-to {
  margin-left: -20px;
  opacity: 0;
}

.slide-right-enter-from {
  margin-left: -20px;
  opacity: 0;
}

.slide-right-leave-to {
  margin-left: 20px;
  opacity: 0;
}

.slide-top-enter-from {
  margin-top: 20px;
  opacity: 0;
}

.slide-top-leave-to {
  margin-top: -20px;
  opacity: 0;
}

.slide-bottom-enter-from {
  margin-top: -20px;
  opacity: 0;
}

.slide-bottom-leave-to {
  margin-top: 20px;
  opacity: 0;
}
</style>
