<i18n lang="yaml">
zh-cn:
  description: VueUse 是一个 Vue Composition API 实用程序的集合，更多 API 和例子请查看 VueUse 官网。
  debounce:
    description: 所谓防抖，就是指触发事件后在 n 秒内函数只能执行一次，如果在 n 秒内又触发了事件，则会重新计算函数执行时间。
    button: 连续点击我，只会执行最后一次点击事件
  throttle:
    description: 所谓节流，就是指连续触发事件但是在 n 秒中只执行一次函数。节流会稀释函数的执行频率。
    button: 连续点击我，每一秒只会执行一次点击事件
  clipboard:
    button: 复制
zh-tw:
  description: VueUse 是一个 Vue Composition API 實用程序的集合，更多 API 和例子請查看 VueUse 官網。
  debounce:
    description: 所謂防抖，就是指觸發事件後在 n 秒內函數只能執行一次，如果在 n 秒內又觸發了事件，則會重新計算函數執行時間。
    button: 连续点击我，只会执行最后一次点击事件
  throttle:
    description: 所謂節流，就是指連續觸發事件但是在 n 秒中只執行一次函數。節流會稀釋函數的執行頻率。
    button: 连续点击我，每一秒只会执行一次点击事件
  clipboard:
    button: 复制
en:
  description: VueUse is a collection of Vue Composition API utilities, more API and examples please check the VueUse website.
  debounce:
    description: Debounce is a function that only executes after a certain amount of time has passed since the last time it was called.
    button: Click me, only the last click event will be executed
  throttle:
    description: Throttle is a function that only executes at most once per specified time interval.
    button: Click me, only one click event will be executed every second
  clipboard:
    button: Copy
</i18n>

<script setup lang="ts">
import { useClipboard, useDebounceFn, useThrottleFn } from '@vueuse/core'

const { t } = useI18n()

function message() {
  useFaToast().success('Toast')
}

const debounce = useDebounceFn(() => {
  message()
}, 1000)

const throttle = useThrottleFn(() => {
  message()
}, 1000)

const input = ref('test')
const { text, copy, copied, isSupported } = useClipboard({ legacy: true })
watch(copied, (val) => {
  val && useFaToast().success(text.value)
})

function open(url: string) {
  window.open(url, '_blank')
}
</script>

<template>
  <div>
    <FaPageHeader title="VueUse" :description="t('description')">
      <FaButton variant="outline" size="icon" @click="open('https://github.com/vueuse/vueuse')">
        <FaIcon name="i-simple-icons:github" />
      </FaButton>
    </FaPageHeader>
    <FaPageMain title="debounce" main-class="flex-col-start gap-2">
      <p class="mt-0">
        {{ t('debounce.description') }}
      </p>
      <FaButton @click="debounce">
        {{ t('debounce.button') }}
      </FaButton>
    </FaPageMain>
    <FaPageMain title="throttle" main-class="flex-col-start gap-2">
      <p class="mt-0">
        {{ t('throttle.description') }}
      </p>
      <FaButton @click="throttle">
        {{ t('throttle.button') }}
      </FaButton>
    </FaPageMain>
    <FaPageMain v-if="isSupported" title="clipboard" main-class="flex-center-start gap-2">
      <FaInput v-model="input" />
      <FaButton @click="copy(input)">
        {{ t('clipboard.button') }}
      </FaButton>
    </FaPageMain>
  </div>
</template>
