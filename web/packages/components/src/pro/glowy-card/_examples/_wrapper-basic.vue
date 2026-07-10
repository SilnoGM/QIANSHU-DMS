<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaIcon from '../../../basic/icon/index.vue'
import FaGlowyCardWrapper from '../GlowyCardWrapper.vue'
import FaGlowyCard from '../index.vue'
</script>

<template>
  <FaGlowyCardWrapper :hue="280" :saturation="80" :lightness="65" :size="260" class="max-w-sm">
    <FaGlowyCard class="rounded-lg">
      <div class="p-6 flex flex-col gap-3">
        <div class="border border-primary/10 rounded-xl flex-center size-10">
          <FaIcon name="i-lucide:sparkles" class="text-2xl" />
        </div>
        <h1 class="text-2xl font-medium">
          光晕容器
        </h1>
        <p class="text-sm text-muted-foreground leading-6">
          移动鼠标时，Wrapper 会同步内部卡片的光标位置并驱动发光边框。
        </p>
      </div>
    </FaGlowyCard>
  </FaGlowyCardWrapper>
</template>
