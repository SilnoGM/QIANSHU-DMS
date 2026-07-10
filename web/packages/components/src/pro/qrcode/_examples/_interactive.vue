<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaButton from '../../../basic/button/index.vue'
import FaInput from '../../../basic/input/index.vue'
import FaQrcode from '../index.vue'

const qrcodeRef = useTemplateRef('qrcodeRef')

const qrValue = ref('https://fantastic-admin.hurui.me')
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex gap-4 items-center">
      <FaInput v-model="qrValue" placeholder="输入二维码内容" class="w-64" />
      <FaButton variant="secondary" @click="qrcodeRef?.download('my-qrcode.png')">
        下载
      </FaButton>
    </div>
    <FaQrcode
      ref="qrcodeRef"
      :value="qrValue"
      :size="200"
    />
  </div>
</template>
