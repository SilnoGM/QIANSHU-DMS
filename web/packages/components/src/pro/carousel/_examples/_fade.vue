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
  <div class="mx-auto max-w-80">
    <FaCarousel fade>
      <img v-for="(item, index) in carouselList" :key="index" :src="item" class="border rounded-xl size-full object-cover" :style="{ transform: `rotate(${index * 90}deg)` }">
    </FaCarousel>
  </div>
</template>
