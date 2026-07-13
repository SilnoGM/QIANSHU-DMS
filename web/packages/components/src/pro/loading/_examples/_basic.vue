<script setup lang="ts">
import type { LoadingProps } from '../index'
import { ref, shallowRef } from 'vue'
import FaButtonGroup from '../../../basic/button/ButtonGroup.vue'
import FaButton from '../../../basic/button/index.vue'
import FaInput from '../../../basic/input/index.vue'
import FaSlider from '../../../basic/slider/index.vue'
import { useFaLoading } from '../../../index'

type LoadingType = NonNullable<LoadingProps['type']>

const loadingTypeOptions: { label: string, value: LoadingType }[] = [
  { label: 'Plane', value: 'plane' },
  { label: 'Chase', value: 'chase' },
  { label: 'Bounce', value: 'bounce' },
  { label: 'Wave', value: 'wave' },
  { label: 'Pulse', value: 'pulse' },
  { label: 'Flow', value: 'flow' },
  { label: 'Swing', value: 'swing' },
  { label: 'Circle', value: 'circle' },
  { label: 'Circle Fade', value: 'circle-fade' },
  { label: 'Grid', value: 'grid' },
  { label: 'Fold', value: 'fold' },
  { label: 'Wander', value: 'wander' },
]

const type = shallowRef<LoadingType>('plane')
const size = ref<number[]>([50])
const text = shallowRef('加载中...')

function showLoading() {
  const { close } = useFaLoading({
    type: type.value,
    size: size.value[0],
    text: text.value,
  })

  setTimeout(() => {
    close()
  }, 2000)
}
</script>

<template>
  <div class="flex-col-start gap-4">
    <div class="flex gap-4 items-center">
      <div class="text-sm font-bold">
        类型
      </div>
      <FaButtonGroup class="flex-wrap">
        <FaButton
          v-for="item in loadingTypeOptions"
          :key="item.value"
          :variant="type === item.value ? 'default' : 'outline'"
          size="sm"
          :class="{ 'z-1': type === item.value }"
          @click="type = item.value"
        >
          {{ item.label }}
        </FaButton>
      </FaButtonGroup>
    </div>
    <div class="flex gap-4 items-center">
      <div class="text-sm font-bold">
        尺寸
      </div>
      <FaSlider v-model="size" :min="20" :max="80" :step="10" class="w-50" />
    </div>
    <div class="flex gap-4 items-center">
      <div class="text-sm font-bold">
        文字
      </div>
      <FaInput v-model="text" />
    </div>
    <FaButton @click="showLoading">
      加载 Loading
    </FaButton>
  </div>
</template>
