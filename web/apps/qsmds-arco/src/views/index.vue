<script setup lang="ts">
import eventBus from '@/utils/eventBus'

// 版本号与登录页同源：构建期由 vite define 注入的应用版本，避免两处显示分叉。
const appVersion = `V${__SYSTEM_INFO__.pkg.version}`
const appTitle = import.meta.env.VITE_APP_TITLE
const { t } = useI18n()

// 系统信息抽屉此前只有快捷键可达，首页给它一个可见入口。
function openSystemInfo() {
  eventBus.emit('global-system-info-open')
}
</script>

<template>
  <div class="inset-0 absolute overflow-auto">
    <FaPageMain class="min-h-[calc(100%-2rem)]" main-class="flex flex-1 items-center justify-center">
      <section class="mx-auto px-2 py-10 text-center max-w-2xl md-py-16">
        <span class="p-3 border border-primary/20 rounded-xl bg-primary/8 inline-flex md-p-4">
          <img src="@/assets/images/logo.svg" :alt="`${appTitle} LOGO`" class="h-12 w-12 object-contain md-h-14 md-w-14">
        </span>
        <h1 class="qs-type-display-title mx-auto mb-0 mt-5 max-w-xl">
          欢迎使用千树数据管理平台
          <span class="font-qs-data-mono text-primary">{{ appVersion }}</span>
          预览版
        </h1>
        <p class="qs-type-body-relaxed text-muted-foreground mx-auto mb-0 mt-3 max-w-md">
          内部预览版本，功能持续完善中。
        </p>
        <FaButton variant="outline" class="mt-8" @click="openSystemInfo">
          <FaIcon name="i-lucide:info" />
          {{ t('app.components.systemInfo.title') }}
        </FaButton>
      </section>
    </FaPageMain>
  </div>
</template>
