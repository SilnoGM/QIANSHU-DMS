<script setup lang="ts">
import { ref } from 'vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaPageMain from '../../../basic/page-main/index.vue'
import FaSelect from '../../../basic/select/index.vue'
import FaSwitch from '../../../basic/switch/index.vue'
import FaPatternBg from '../index.vue'

const variant = ref<'grid' | 'dot' | 'big-dot'>('grid')
const size = ref<'xs' | 'sm' | 'md' | 'lg'>('md')
const mask = ref<'ellipse' | 'ellipse-top' | 'ellipse-bottom' | 'ellipse-left' | 'ellipse-right' | 'ellipse-top-left' | 'ellipse-top-right' | 'ellipse-bottom-left' | 'ellipse-bottom-right'>('ellipse')
const animate = ref(true)
const direction = ref<'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>('top')
</script>

<template>
  <FaPageMain class="m-0" main-class="flex gap-4">
    <div class="flex gap-2 items-center">
      <span>图案</span>
      <FaSelect
        v-model="variant" :options="[
          { label: 'grid', value: 'grid' },
          { label: 'dot', value: 'dot' },
          { label: 'big-dot', value: 'big-dot' },
        ]"
      />
    </div>
    <div class="flex gap-2 items-center">
      <span>尺寸</span>
      <FaSelect
        v-model="size" :options="[
          { label: 'xs', value: 'xs' },
          { label: 'sm', value: 'sm' },
          { label: 'md', value: 'md' },
          { label: 'lg', value: 'lg' },
        ]"
      />
    </div>
    <div class="flex gap-2 items-center">
      <span>动画</span>
      <FaSwitch v-model="animate" />
    </div>
    <div class="flex gap-2 items-center">
      <span>方向</span>
      <FaSelect
        v-model="direction" :options="[
          { label: 'top-left', value: 'top-left' },
          { label: 'top-right', value: 'top-right' },
          { label: 'bottom-left', value: 'bottom-left' },
          { label: 'bottom-right', value: 'bottom-right' },
          { label: 'top', value: 'top' },
          { label: 'bottom', value: 'bottom' },
          { label: 'left', value: 'left' },
          { label: 'right', value: 'right' },
        ]"
      />
    </div>
    <div class="flex gap-2 items-center">
      <span>遮罩</span>
      <FaSelect
        v-model="mask" :options="[
          { label: 'ellipse', value: 'ellipse' },
          { label: 'ellipse-top', value: 'ellipse-top' },
          { label: 'ellipse-bottom', value: 'ellipse-bottom' },
          { label: 'ellipse-left', value: 'ellipse-left' },
          { label: 'ellipse-right', value: 'ellipse-right' },
          { label: 'ellipse-top-left', value: 'ellipse-top-left' },
          { label: 'ellipse-top-right', value: 'ellipse-top-right' },
          { label: 'ellipse-bottom-left', value: 'ellipse-bottom-left' },
          { label: 'ellipse-bottom-right', value: 'ellipse-bottom-right' },
        ]"
      />
    </div>
  </FaPageMain>
  <FaPatternBg :variant :size :animate :direction :mask class="h-100" />
</template>
