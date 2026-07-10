<script setup lang="ts">
import { shallowRef } from 'vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaScratchOff from '../index.vue'

const completed = shallowRef(false)

function handleComplete() {
  completed.value = true
}
</script>

<template>
  <div class="flex flex-col gap-3 items-start">
    <FaScratchOff
      :width="250"
      :height="250"
      :min-scratch-percentage="30"
      class="border-2 rounded-2xl bg-gray-100 flex items-center justify-center overflow-hidden"
      @complete="handleComplete"
    >
      <div class="text-8xl">
        🥳
      </div>
    </FaScratchOff>
    <div class="text-sm text-muted-foreground">
      {{ completed ? '恭喜你刮中了' : '刮开涂层查看结果' }}
    </div>
  </div>
</template>
