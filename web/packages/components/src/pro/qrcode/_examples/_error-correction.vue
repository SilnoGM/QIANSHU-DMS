<script setup lang="ts">
import { ref } from 'vue'
import FaButtonGroup from '../../../basic/button/ButtonGroup.vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaButton from '../../../basic/button/index.vue'
import FaQrcode from '../index.vue'

const errorCorrectionLevel = ref<'L' | 'M' | 'Q' | 'H'>('M')
const qrValue = ref('https://fantastic-admin.hurui.me')

const levels = [
  { label: 'L', value: 'L' as const, desc: '7%' },
  { label: 'M', value: 'M' as const, desc: '15%' },
  { label: 'Q', value: 'Q' as const, desc: '25%' },
  { label: 'H', value: 'H' as const, desc: '30%' },
]
</script>

<template>
  <div class="space-y-2">
    <FaButtonGroup>
      <FaButton
        v-for="item in levels"
        :key="item.value"
        :variant="errorCorrectionLevel === item.value ? 'default' : 'outline'"
        @click="errorCorrectionLevel = item.value"
      >
        {{ item.label }}
      </FaButton>
    </FaButtonGroup>
    <FaQrcode
      :value="qrValue"
      :size="150"
      :error-correction-level="errorCorrectionLevel"
    />
  </div>
</template>
