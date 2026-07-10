<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaButton from '../../../basic/button/index.vue'
import FaDivider from '../../../basic/divider/index.vue'
import FaFlipCard from '../index.vue'
</script>

<template>
  <FaFlipCard class="h-72 max-w-full w-128">
    <div class="size-full">
      <img src="https://picsum.photos/560/720" class="size-full object-cover">
      <div class="text-xl text-white font-bold text-shadow-lg inset-x-4 bottom-4 absolute">
        自定义尺寸
      </div>
    </div>
    <template #back>
      <div class="p-4 flex flex-col h-full">
        <h1 class="text-xl text-card-foreground font-bold">
          什么是 Fantastic-admin ?
        </h1>
        <FaDivider class="my-2" />
        <p class="text-base text-card-foreground leading-normal font-medium">
          Fantastic-admin 是一个基于 Vue 3 的后台管理系统框架，它集成了丰富的组件和工具函数，可以帮助开发者快速构建现代化的管理系统。
        </p>
        <FaButton class="mt-auto">
          按钮
        </FaButton>
      </div>
    </template>
  </FaFlipCard>
</template>
