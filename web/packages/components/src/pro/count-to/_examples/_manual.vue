<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import { shallowRef, useTemplateRef } from 'vue'
import FaButton from '../../../basic/button/index.vue'
import FaCountTo from '../index.vue'

const countToRef = useTemplateRef<InstanceType<typeof FaCountTo>>('countToRef')

const startVal = shallowRef(0)
const endVal = shallowRef(10000)
const status = shallowRef('等待开始')

function onStarted() {
  status.value = '开始'
}

function onFinished() {
  status.value = '结束'
}

function increase() {
  endVal.value += 1000
}

function decrease() {
  endVal.value -= 1000
}
</script>

<template>
  <div class="flex flex-col gap-3 items-start">
    <FaCountTo ref="countToRef" :start-val="startVal" :end-val="endVal" :autoplay="false" @on-started="onStarted" @on-finished="onFinished" />
    <div class="text-sm text-muted-foreground">
      状态：{{ status }}
    </div>
    <div class="flex flex-row gap-2">
      <FaButton @click="countToRef?.start">
        开始
      </FaButton>
      <FaButton @click="countToRef?.reset">
        重置
      </FaButton>
      <FaButton @click="increase">
        增加1000
      </FaButton>
      <FaButton @click="decrease">
        减少1000
      </FaButton>
    </div>
  </div>
</template>
