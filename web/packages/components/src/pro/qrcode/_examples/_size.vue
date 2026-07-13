<script setup lang="ts">
import { computed, ref } from 'vue'
import FaSlider from '../../../basic/slider/index.vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaQrcode from '../index.vue'

const sizeValue = ref([200])
const qrValue = ref('https://fantastic-admin.hurui.me')

const size = computed(() => sizeValue.value[0])
</script>

<template>
  <div class="space-y-2">
    <div class="flex gap-4 items-center">
      <FaSlider v-model="sizeValue" :min="100" :max="400" :step="100" class="w-48" />
      <span class="text-sm text-muted-foreground w-16">{{ size }}px</span>
    </div>
    <FaQrcode
      :value="qrValue"
      :size="size"
    />
  </div>
</template>
