<script setup lang="ts">
import { ref } from 'vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaQrcode from '../index.vue'
import logoSvg from './logo.svg'

const qrValue = ref('https://fantastic-admin.hurui.me')
</script>

<template>
  <div class="flex gap-6">
    <div class="flex flex-col gap-2 items-center">
      <span class="text-sm text-muted-foreground">基础二维码</span>
      <FaQrcode :value="qrValue" :size="150" />
    </div>

    <div class="flex flex-col gap-2 items-center">
      <span class="text-sm text-muted-foreground">带 Logo (网络图片)</span>
      <FaQrcode
        :value="qrValue"
        :size="150"
        logo="https://fantastic-admin.hurui.me/logo.svg"
      />
    </div>

    <div class="flex flex-col gap-2 items-center">
      <span class="text-sm text-muted-foreground">带 Logo (本地图片)</span>
      <FaQrcode
        :value="qrValue"
        :size="150"
        :logo="logoSvg"
      />
    </div>
  </div>
</template>
