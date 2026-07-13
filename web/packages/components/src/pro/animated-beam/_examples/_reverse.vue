<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import { useTemplateRef } from 'vue'
import FaIcon from '../../../basic/icon/index.vue'
import FaAnimatedBeam from '../index.vue'

const containerRef = useTemplateRef<HTMLElement>('containerRef')
const githubRef = useTemplateRef<HTMLElement>('githubRef')
const googleRef = useTemplateRef<HTMLElement>('googleRef')
</script>

<template>
  <div ref="containerRef" class="p-10 flex w-full items-center justify-center relative overflow-hidden">
    <div class="flex size-full justify-between">
      <div ref="githubRef" class="p-4 border-2 rounded-full bg-card flex shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)] items-center justify-center z-10">
        <FaIcon name="i-logos:github" class="size-20" />
      </div>
      <div ref="googleRef" class="p-4 border-2 rounded-full bg-card flex shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)] items-center justify-center z-10">
        <FaIcon name="i-logos:google" class="size-20" />
      </div>
    </div>
    <FaAnimatedBeam
      :container-ref="containerRef"
      :from-ref="githubRef"
      :to-ref="googleRef"
      :curvature="-50"
      :start-y-offset="20"
      :end-y-offset="20"
    />
    <FaAnimatedBeam
      :container-ref="containerRef"
      :from-ref="githubRef"
      :to-ref="googleRef"
      :curvature="50"
      :start-y-offset="-20"
      :end-y-offset="-20"
      reverse
    />
  </div>
</template>
