<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaDivider from '../../../basic/divider/index.vue'
import FaFlipCard from '../index.vue'
</script>

<template>
  <div class="flex flex-wrap gap-4">
    <FaFlipCard>
      <div class="text-xl font-bold flex-center size-full">
        水平翻转
      </div>
      <template #back>
        <div class="p-4 flex flex-col">
          <h1 class="text-xl text-card-foreground font-bold">
            什么是 Fantastic-admin ?
          </h1>
          <FaDivider class="my-2" />
          <p class="text-base text-card-foreground leading-normal font-medium">
            Fantastic-admin 是一个基于 Vue 3 的后台管理系统框架，它集成了丰富的组件和工具函数，可以帮助开发者快速构建现代化的管理系统。
          </p>
        </div>
      </template>
    </FaFlipCard>
    <FaFlipCard rotate="x">
      <div class="text-xl font-bold flex-center size-full">
        垂直翻转
      </div>
      <template #back>
        <div class="p-4 flex flex-col">
          <h1 class="text-xl text-card-foreground font-bold">
            什么是 Fantastic-admin ?
          </h1>
          <FaDivider class="my-2" />
          <p class="text-base text-card-foreground leading-normal font-medium">
            Fantastic-admin 是一个基于 Vue 3 的后台管理系统框架，它集成了丰富的组件和工具函数，可以帮助开发者快速构建现代化的管理系统。
          </p>
        </div>
      </template>
    </FaFlipCard>
  </div>
</template>
