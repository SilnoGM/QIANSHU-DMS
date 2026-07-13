<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaCarousel from '../index.vue'

const carouselList = [
  'https://fantastic-admin.hurui.me/logo.svg',
  'https://fantastic-admin.hurui.me/logo.svg',
  'https://fantastic-admin.hurui.me/logo.svg',
  'https://fantastic-admin.hurui.me/logo.svg',
]
</script>

<template>
  <div class="p-12 flex-center gap-30">
    <FaCarousel class="size-80">
      <img v-for="(item, index) in carouselList" :key="index" :src="item" class="border rounded-xl size-full object-cover" :style="{ transform: `rotate(${index * 90}deg)` }">
    </FaCarousel>
    <!-- 垂直时需注意，高度要增加1rem -->
    <FaCarousel orientation="vertical" class="size-80" content-class="w-80 h-84">
      <img v-for="(item, index) in carouselList" :key="index" :src="item" class="border rounded-xl size-full object-cover" :style="{ transform: `rotate(${index * 90}deg)` }">
    </FaCarousel>
  </div>
</template>
