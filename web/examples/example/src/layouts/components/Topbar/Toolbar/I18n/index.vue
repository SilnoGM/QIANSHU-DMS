<script setup lang="ts">
import { localesInfo } from '@/locales'

defineOptions({
  name: 'ToolbarI18n',
})

const appSettingsStore = useAppSettingsStore()

const langItems = computed(() => {
  return Object.keys(localesInfo).map((item: any) => ({
    label: localesInfo[item].label,
    disabled: appSettingsStore.lang === item,
    handle: () => appSettingsStore.setDefaultLang(item),
  }))
})

const isAnimating = ref(false)

watch(() => appSettingsStore.lang, (newVal, oldVal) => {
  if (newVal !== oldVal) {
    isAnimating.value = true
  }
})
</script>

<template>
  <FaDropdown :items="[langItems]">
    <FaButton variant="ghost" size="icon-sm" :class="{ animation: isAnimating }" @animationend="isAnimating = false">
      <FaIcon name="i-ri:translate" class="size-4" />
    </FaButton>
  </FaDropdown>
</template>

<style scoped>
.animation {
  transform-origin: center top;
  animation: animation 1s;
}

@keyframes animation {
  0% {
    transform: rotateY(0deg);
  }

  100% {
    transform: rotateY(360deg);
  }
}
</style>
