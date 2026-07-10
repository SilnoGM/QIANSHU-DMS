<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import { useTemplateRef } from 'vue'
import FaIcon from '../../../basic/icon/index.vue'
import FaAnimatedBeam from '../index.vue'
import logo from './logo.svg'

const containerRef = useTemplateRef<HTMLElement>('containerRef')
const centerRef = useTemplateRef<HTMLElement>('centerRef')
const epRef = useTemplateRef<HTMLElement>('epRef')
const antdvRef = useTemplateRef<HTMLElement>('antdvRef')
const arcoRef = useTemplateRef<HTMLElement>('arcoRef')
const naiveRef = useTemplateRef<HTMLElement>('naiveRef')
const tdesignRef = useTemplateRef<HTMLElement>('tdesignRef')
const vexipRef = useTemplateRef<HTMLElement>('vexipRef')
const iduxRef = useTemplateRef<HTMLElement>('iduxRef')
</script>

<template>
  <div ref="containerRef" class="p-10 flex h-100 w-full items-center justify-center relative overflow-hidden">
    <div class="flex flex-col gap-10 size-full max-w-2xl items-stretch justify-between">
      <div class="flex flex-row items-center justify-center">
        <div ref="centerRef" class="p-4 border-2 rounded-12 bg-card flex shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)] items-center justify-center z-10">
          <FaIcon :name="logo" class="size-20" />
        </div>
      </div>
      <div class="flex flex-row items-end justify-between">
        <div ref="epRef" class="mb-12 p-3 border-2 rounded-3xl bg-card flex shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)] items-center justify-center z-10">
          <FaIcon name="i-logos:element" class="size-8" />
        </div>
        <div ref="antdvRef" class="mb-6 p-3 border-2 rounded-3xl bg-card flex shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)] items-center justify-center z-10">
          <FaIcon name="i-logos:ant-design" class="size-8" />
        </div>
        <div ref="arcoRef" class="mb-2 p-3 border-2 rounded-3xl bg-card flex shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)] items-center justify-center z-10">
          <FaIcon name="https://unpkg.byted-static.com/latest/byted/arco-config/assets/favicon.ico" class="size-8" />
        </div>
        <div ref="naiveRef" class="p-3 border-2 rounded-3xl bg-card flex shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)] items-center justify-center z-10">
          <FaIcon name="i-logos:naiveui" class="size-8" />
        </div>
        <div ref="tdesignRef" class="mb-2 p-3 border-2 rounded-3xl bg-card flex shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)] items-center justify-center z-10">
          <FaIcon name="https://static.tdesign.tencent.com/favicon.ico" class="size-8" />
        </div>
        <div ref="vexipRef" class="mb-6 p-3 border-2 rounded-3xl bg-card flex shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)] items-center justify-center z-10">
          <FaIcon name="https://www.vexipui.com/vexip-ui.svg" class="size-8" />
        </div>
        <div ref="iduxRef" class="mb-12 p-3 border-2 rounded-3xl bg-card flex shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)] items-center justify-center z-10">
          <FaIcon name="https://idux.site/favicon.ico" class="size-8" />
        </div>
      </div>
    </div>
    <FaAnimatedBeam :container-ref="containerRef" :from-ref="centerRef" :to-ref="epRef" :curvature="-150" dotted />
    <FaAnimatedBeam :container-ref="containerRef" :from-ref="centerRef" :to-ref="antdvRef" :curvature="-150" dotted />
    <FaAnimatedBeam :container-ref="containerRef" :from-ref="centerRef" :to-ref="arcoRef" :curvature="-150" dotted />
    <FaAnimatedBeam :container-ref="containerRef" :from-ref="centerRef" :to-ref="naiveRef" dotted />
    <FaAnimatedBeam :container-ref="containerRef" :from-ref="centerRef" :to-ref="tdesignRef" :curvature="-150" dotted />
    <FaAnimatedBeam :container-ref="containerRef" :from-ref="centerRef" :to-ref="vexipRef" :curvature="-150" dotted />
    <FaAnimatedBeam :container-ref="containerRef" :from-ref="centerRef" :to-ref="iduxRef" :curvature="-150" dotted />
  </div>
</template>
