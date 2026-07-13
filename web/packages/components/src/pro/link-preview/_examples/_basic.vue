<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaLinkPreview from '../index.vue'
</script>

<template>
  <p class="text-xl">
    <FaLinkPreview url="https://fantastic-admin.hurui.me/" :width="300" :height="200" link-class="font-bold">
      Fantastic-admin
    </FaLinkPreview>
    的技术栈：
    <FaLinkPreview url="https://cn.vitejs.dev/" link-class="text-[#9C5DFE] font-bold">
      Vite
    </FaLinkPreview>
    /
    <FaLinkPreview url="https://cn.vuejs.org/" link-class="text-[#42B883] font-bold">
      Vue.js
    </FaLinkPreview>
    /
    <FaLinkPreview url="https://router.vuejs.org/zh/" link-class="text-[#18794E] font-bold">
      Vue Router
    </FaLinkPreview>
    /
    <FaLinkPreview url="https://unocss.dev/" link-class="text-[#4D4D4D] font-bold">
      UnoCSS
    </FaLinkPreview>
  </p>
</template>
