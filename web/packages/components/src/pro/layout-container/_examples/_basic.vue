<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import { ref } from 'vue'
import FaPageMain from '../../../basic/page-main/index.vue'
import FaSlider from '../../../basic/slider/index.vue'
import FaSwitch from '../../../basic/switch/index.vue'
import FaLayoutContainer from '../index.vue'

const vertical = ref(false)
const hideLeftSide = ref(false)
const hideRightSide = ref(false)
const hideTopSide = ref(false)
const hideBottomSide = ref(false)
const leftSideWidth = ref([250])
const rightSideWidth = ref([250])
const topSideHeight = ref([150])
const bottomSideHeight = ref([150])
</script>

<template>
  <FaLayoutContainer
    :vertical="vertical"
    :hide-left-side="hideLeftSide"
    :hide-right-side="hideRightSide"
    :hide-top-side="hideTopSide"
    :hide-bottom-side="hideBottomSide"
    :left-side-width="leftSideWidth[0]"
    :right-side-width="rightSideWidth[0]"
    :top-side-height="topSideHeight[0]"
    :bottom-side-height="bottomSideHeight[0]"
  >
    <template #leftSide>
      <div class="text-sm mb-3">
        左侧宽度
      </div>
      <FaSlider v-model="leftSideWidth" :step="10" :min="200" :max="300" />
    </template>
    <template #rightSide>
      <div class="text-sm mb-3">
        右侧宽度
      </div>
      <FaSlider v-model="rightSideWidth" :step="10" :min="200" :max="300" />
    </template>
    <template #topSide>
      <div class="text-sm mb-3">
        顶部高度
      </div>
      <FaSlider v-model="topSideHeight" :step="10" :min="100" :max="200" />
    </template>
    <template #bottomSide>
      <div class="text-sm mb-3">
        底部高度
      </div>
      <FaSlider v-model="bottomSideHeight" :step="10" :min="100" :max="200" />
    </template>
    <div class="space-y-4">
      <div class="gap-4 grid grid-cols-4">
        <FaPageMain title="布局方向" class="m-0 col-span-4" main-class="flex-center-start gap-2">
          <span class="text-sm">水平</span>
          <FaSwitch v-model="vertical" />
          <span class="text-sm">垂直</span>
        </FaPageMain>
        <FaPageMain title="隐藏左侧栏" class="m-0">
          <FaSwitch v-model="hideLeftSide" />
        </FaPageMain>
        <FaPageMain title="隐藏右侧栏" class="m-0">
          <FaSwitch v-model="hideRightSide" />
        </FaPageMain>
        <FaPageMain title="隐藏顶部栏" class="m-0">
          <FaSwitch v-model="hideTopSide" />
        </FaPageMain>
        <FaPageMain title="隐藏底部栏" class="m-0">
          <FaSwitch v-model="hideBottomSide" />
        </FaPageMain>
      </div>
    </div>
  </FaLayoutContainer>
</template>
