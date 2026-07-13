<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaTextHighlight from '../index.vue'
</script>

<template>
  <p class="text-4xl font-bold">
    依次从
    <FaTextHighlight
      from="left"
      :delay="0"
      :duration="700"
      class="rounded-lg from-blue-200 to-cyan-200 bg-gradient-to-r"
    >
      左侧
    </FaTextHighlight>
    、
    <FaTextHighlight
      from="right"
      :delay="300"
      :duration="700"
      class="rounded-lg from-pink-200 to-rose-200 bg-gradient-to-r"
    >
      右侧
    </FaTextHighlight>
    、
    <FaTextHighlight
      from="top"
      :delay="600"
      :duration="700"
      class="rounded-lg from-emerald-200 to-lime-200 bg-gradient-to-b"
    >
      顶部
    </FaTextHighlight>
    、
    <FaTextHighlight
      from="bottom"
      :delay="900"
      :duration="700"
      class="rounded-lg from-amber-200 to-orange-200 bg-gradient-to-b"
    >
      底部
    </FaTextHighlight>
    展开。
  </p>
</template>
