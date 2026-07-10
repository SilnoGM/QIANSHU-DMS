<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import QRCode from 'qrcode'
import { computed, onMounted, ref, watch } from 'vue'
import { cn } from '#utils'

defineOptions({
  name: 'BuiltInQrcode',
})

const props = withDefaults(defineProps<{
  value: string
  size?: number
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
  logo?: string
  logoSize?: number
  logoBackgroundColor?: string
  foregroundColor?: string
  backgroundColor?: string
  status?: 'loading' | 'expired' | 'scanned' | 'error' | string
  class?: HTMLAttributes['class']
}>(), {
  size: 200,
  errorCorrectionLevel: 'H',
  logoSize: 0.2,
  logoBackgroundColor: '#ffffff',
  foregroundColor: '#000000',
  backgroundColor: '#ffffff',
})

const emits = defineEmits<{
  statusRender: [status: string]
}>()

defineSlots<{
  statusRender?: (props: { status: string }) => any
}>()

const FIXED_SIZE = 400 // 固定高分辨率用于生成二维码

const canvasRef = ref<HTMLCanvasElement | null>(null)
const internalStatus = ref<string>()

const hasStatus = computed(() => !!props.status)

watch(() => props.status, (newStatus) => {
  if (newStatus) {
    internalStatus.value = newStatus
    emits('statusRender', newStatus)
  }
}, { immediate: true })

async function drawQRCode() {
  if (!canvasRef.value) {
    return
  }

  const ctx = canvasRef.value.getContext('2d')
  if (!ctx) {
    return
  }

  // 清空画布
  ctx.clearRect(0, 0, FIXED_SIZE, FIXED_SIZE)

  // 绘制背景
  ctx.fillStyle = props.backgroundColor
  ctx.fillRect(0, 0, FIXED_SIZE, FIXED_SIZE)

  // 生成二维码（使用固定分辨率）
  const qrDataUrl = await QRCode.toDataURL(props.value, {
    width: FIXED_SIZE,
    errorCorrectionLevel: props.errorCorrectionLevel,
    color: {
      dark: props.foregroundColor,
      light: props.backgroundColor,
    },
    margin: 2,
  })

  // 创建临时图片对象绘制二维码
  const qrImage = new Image()
  qrImage.src = qrDataUrl

  await new Promise((resolve) => {
    qrImage.onload = resolve
  })

  ctx.drawImage(qrImage, 0, 0)

  // 如果有 logo，绘制在中间
  if (props.logo) {
    await drawLogo(ctx, props.logo)
  }
}

async function drawLogo(ctx: CanvasRenderingContext2D, logo: string) {
  const logoImage = new Image()
  logoImage.crossOrigin = 'anonymous'
  logoImage.src = logo

  await new Promise((resolve, reject) => {
    logoImage.onload = resolve
    logoImage.onerror = reject
  })

  // 计算 logo 尺寸和位置（基于固定分辨率）
  const logoSize = FIXED_SIZE * props.logoSize
  const logoX = (FIXED_SIZE - logoSize) / 2
  const logoY = (FIXED_SIZE - logoSize) / 2

  // 绘制 logo 背景（白色圆角矩形）
  const padding = logoSize * 0.1
  const bgSize = logoSize + padding * 2
  const bgX = logoX - padding
  const bgY = logoY - padding
  const radius = bgSize * 0.15

  ctx.save()
  ctx.fillStyle = props.logoBackgroundColor
  ctx.shadowColor = 'rgba(0, 0, 0, 0.1)'
  ctx.shadowBlur = 8
  ctx.shadowOffsetY = 2

  // 绘制圆角矩形背景
  ctx.beginPath()
  ctx.moveTo(bgX + radius, bgY)
  ctx.lineTo(bgX + bgSize - radius, bgY)
  ctx.quadraticCurveTo(bgX + bgSize, bgY, bgX + bgSize, bgY + radius)
  ctx.lineTo(bgX + bgSize, bgY + bgSize - radius)
  ctx.quadraticCurveTo(bgX + bgSize, bgY + bgSize, bgX + bgSize - radius, bgY + bgSize)
  ctx.lineTo(bgX + radius, bgY + bgSize)
  ctx.quadraticCurveTo(bgX, bgY + bgSize, bgX, bgY + bgSize - radius)
  ctx.lineTo(bgX, bgY + radius)
  ctx.quadraticCurveTo(bgX, bgY, bgX + radius, bgY)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // 绘制 logo 图片
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(bgX + radius, bgY)
  ctx.lineTo(bgX + bgSize - radius, bgY)
  ctx.quadraticCurveTo(bgX + bgSize, bgY, bgX + bgSize, bgY + radius)
  ctx.lineTo(bgX + bgSize, bgY + bgSize - radius)
  ctx.quadraticCurveTo(bgX + bgSize, bgY + bgSize, bgX + bgSize - radius, bgY + bgSize)
  ctx.lineTo(bgX + radius, bgY + bgSize)
  ctx.quadraticCurveTo(bgX, bgY + bgSize, bgX, bgY + bgSize - radius)
  ctx.lineTo(bgX, bgY + radius)
  ctx.quadraticCurveTo(bgX, bgY, bgX + radius, bgY)
  ctx.closePath()
  ctx.clip()
  ctx.drawImage(logoImage, bgX, bgY, bgSize, bgSize)
  ctx.restore()
}

// 监听属性变化，重新绘制（size 除外，尺寸变化只需 CSS 缩放）
watch(
  () => [props.value, props.errorCorrectionLevel, props.logo, props.logoSize, props.foregroundColor, props.backgroundColor],
  () => {
    drawQRCode()
  },
  { deep: true },
)

// 组件挂载后绘制
onMounted(() => {
  drawQRCode()
})

// 暴露下载方法
function download(filename = 'qrcode.png') {
  if (!canvasRef.value) {
    return
  }

  const link = document.createElement('a')
  link.download = filename
  link.href = canvasRef.value.toDataURL('image/png')
  link.click()
}

defineExpose({
  download,
})
</script>

<template>
  <div :class="cn('relative inline-block', props.class)" :style="{ width: `${size}px`, height: `${size}px` }">
    <canvas
      ref="canvasRef"
      :width="FIXED_SIZE"
      :height="FIXED_SIZE"
      class="size-full"
      :style="{ width: `${size}px`, height: `${size}px` }"
    />
    <div v-if="hasStatus" class="bg-background/80 flex items-center inset-0 justify-center absolute backdrop-blur-xs">
      <slot name="statusRender" :status="internalStatus || ''">
        <template v-if="internalStatus === 'loading'">
          <div class="border-2 border-primary border-t-transparent rounded-full size-6 animate-spin" />
        </template>
      </slot>
    </div>
  </div>
</template>
