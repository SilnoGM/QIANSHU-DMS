<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import { useTemplateRef } from 'vue'
import FaIcon from '../../../basic/icon/index.vue'
import FaAnimatedBeam from '../index.vue'
import logo from './logo.svg'

const containerRef = useTemplateRef<HTMLElement>('containerRef')
const centerRef = useTemplateRef<HTMLElement>('centerRef')
const viteRef = useTemplateRef<HTMLElement>('viteRef')
const vueRef = useTemplateRef<HTMLElement>('vueRef')
const vueuseRef = useTemplateRef<HTMLElement>('vueuseRef')
const piniaRef = useTemplateRef<HTMLElement>('piniaRef')
const unocssRef = useTemplateRef<HTMLElement>('unocssRef')
const tsRef = useTemplateRef<HTMLElement>('tsRef')
</script>

<template>
  <div ref="containerRef" class="p-10 flex h-100 w-full items-center justify-center relative overflow-hidden">
    <div class="flex flex-col gap-10 size-full max-w-2xl items-stretch justify-between">
      <div class="flex flex-row items-center justify-between">
        <div ref="viteRef" class="p-4 border-2 rounded-full bg-card flex shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)] items-center justify-center z-10">
          <FaIcon name="i-logos:vitejs" class="size-8" />
        </div>
        <div ref="piniaRef" class="p-4 border-2 rounded-full bg-card flex shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)] items-center justify-center z-10">
          <FaIcon name="i-logos:pinia" class="size-8" />
        </div>
      </div>
      <div class="flex flex-row items-center justify-between">
        <div ref="vueRef" class="p-4 border-2 rounded-full bg-card flex shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)] items-center justify-center z-10">
          <FaIcon name="i-logos:vue" class="size-8" />
        </div>
        <div ref="centerRef" class="p-4 border-2 rounded-full bg-card flex shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)] items-center justify-center z-10">
          <FaIcon :name="logo" class="size-20" />
        </div>
        <div ref="unocssRef" class="p-4 border-2 rounded-full bg-card flex shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)] items-center justify-center z-10">
          <FaIcon name="i-logos:unocss" class="size-8" />
        </div>
      </div>
      <div class="flex flex-row items-center justify-between">
        <div ref="vueuseRef" class="p-4 border-2 rounded-full bg-card flex shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)] items-center justify-center z-10">
          <FaIcon name="i-logos:vueuse" class="size-8" />
        </div>
        <div ref="tsRef" class="p-4 border-2 rounded-full bg-card flex shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)] items-center justify-center z-10">
          <FaIcon name="i-logos:typescript-icon" class="size-8" />
        </div>
      </div>
    </div>
    <FaAnimatedBeam :container-ref="containerRef" :from-ref="viteRef" :to-ref="centerRef" :curvature="-75" :end-y-offset="-10" />
    <FaAnimatedBeam :container-ref="containerRef" :from-ref="vueRef" :to-ref="centerRef" />
    <FaAnimatedBeam :container-ref="containerRef" :from-ref="vueuseRef" :to-ref="centerRef" :curvature="75" :end-y-offset="10" />
    <FaAnimatedBeam :container-ref="containerRef" :from-ref="piniaRef" :to-ref="centerRef" :curvature="-75" :end-y-offset="-10" />
    <FaAnimatedBeam :container-ref="containerRef" :from-ref="unocssRef" :to-ref="centerRef" />
    <FaAnimatedBeam :container-ref="containerRef" :from-ref="tsRef" :to-ref="centerRef" :curvature="75" :end-y-offset="10" />
  </div>
</template>
