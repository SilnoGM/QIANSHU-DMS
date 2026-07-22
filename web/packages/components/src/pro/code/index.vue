<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { useClipboard } from '@vueuse/core'
import { cn } from '#utils'
import Button from '../../basic/button/index.vue'
import Icon from '../../basic/icon/index.vue'

defineOptions({
  name: 'BuiltInCode',
})

const props = defineProps<{
  code: string
  class?: HTMLAttributes['class']
}>()

const { copy, copied, isSupported } = useClipboard({ legacy: true })
</script>

<template>
  <div :class="cn('group relative w-full rounded-lg bg-dark p-4 text-light', props.class)">
    <pre class="w-full whitespace-pre-line overflow-auto" dir="ltr">
      <code class="text-left whitespace-pre-wrap" tabindex="0">{{ code }}</code>
    </pre>
    <Button v-if="isSupported" variant="secondary" size="icon" class="border border-light/20 opacity-100 transition-opacity end-3 top-3 absolute group-hover:opacity-100 lg:opacity-0" @click="copy(code)">
      <Icon :name="copied ? 'i-lucide:check' : 'i-lucide:copy'" transition class="size-4" />
    </Button>
  </div>
</template>

<style scoped>
code {
  /* 字体资源由宿主应用统一注册，公共组件只消费产品等宽语义 Token。 */
  font-family: var(--qs-font-mono);
}
</style>
