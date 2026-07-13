<script setup lang="ts">
import { ref } from 'vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaQrcode from '../index.vue'

const qrValue = ref('https://fantastic-admin.hurui.me')
</script>

<template>
  <div class="flex flex-wrap gap-6">
    <div class="flex flex-col gap-2 items-center">
      <span class="text-sm text-muted-foreground">经典黑白</span>
      <FaQrcode
        :value="qrValue"
        :size="120"
        foreground-color="#000000"
        background-color="#ffffff"
      />
    </div>

    <div class="flex flex-col gap-2 items-center">
      <span class="text-sm text-muted-foreground">品牌绿色</span>
      <FaQrcode
        :value="qrValue"
        :size="120"
        foreground-color="#059669"
        background-color="#f0fdf4"
      />
    </div>

    <div class="flex flex-col gap-2 items-center">
      <span class="text-sm text-muted-foreground">科技蓝</span>
      <FaQrcode
        :value="qrValue"
        :size="120"
        foreground-color="#2563eb"
        background-color="#eff6ff"
      />
    </div>

    <div class="flex flex-col gap-2 items-center">
      <span class="text-sm text-muted-foreground">活力橙</span>
      <FaQrcode
        :value="qrValue"
        :size="120"
        foreground-color="#ea580c"
        background-color="#fff7ed"
      />
    </div>

    <div class="flex flex-col gap-2 items-center">
      <span class="text-sm text-muted-foreground">暗色模式</span>
      <FaQrcode
        :value="qrValue"
        :size="120"
        foreground-color="#e5e5e5"
        background-color="#171717"
      />
    </div>
  </div>
</template>
