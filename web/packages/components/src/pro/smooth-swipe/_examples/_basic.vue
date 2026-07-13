<script setup lang="ts">
import { ref } from 'vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaButtonGroup from '../../../basic/button/ButtonGroup.vue'
import FaButton from '../../../basic/button/index.vue'
import FaSmoothSwipe from '../index.vue'

const activeIndex = ref<number>(0)
</script>

<template>
  <FaButtonGroup>
    <FaButton v-for="index in 4" :key="index" :variant="activeIndex === index - 1 ? 'default' : 'outline'" @click="activeIndex = index - 1">
      切换到 {{ index }}
    </FaButton>
  </FaButtonGroup>
  <FaSmoothSwipe :active-index>
    <div class="text-20 flex-center h-50">
      1
    </div>
    <div class="text-20 flex-center h-150">
      2
    </div>
    <div class="text-20 flex-center h-100">
      3
    </div>
    <div class="text-20 flex-center h-50">
      4
    </div>
  </FaSmoothSwipe>
</template>
