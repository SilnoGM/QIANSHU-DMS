<i18n lang="yaml">
zh-cn:
  esign: 电子签名
  clean: 清空画板
  generate: 生成图片
  download: 下载图片
zh-tw:
  esign: 電子簽名
  clean: 清空畫板
  generate: 生成圖片
  download: 下載圖片
en:
  esign: E-sign
  clean: Clean Canvas
  generate: Generate Image
  download: Download Image
</i18n>

<script setup lang="ts">
import type { SignCanvasExpose, SignCanvasOptions } from 'sign-canvas'
import SignCanvas from 'sign-canvas'
import Alert from './components/alert.vue'
import Command from './components/command.vue'

const { t } = useI18n()

const signCanvasRef = useTemplateRef<SignCanvasExpose>('signCanvasRef')
const signature = shallowRef<string | null>(null)
const result = shallowRef<string | null>(null)
const options = reactive<SignCanvasOptions>({
  canvasWidth: 600,
  canvasHeight: 360,
  isDpr: true,
  isSign: true,
  writeColor: '#101010',
  bgColor: '#f0f0f0',
  isShowBorder: false,
  imgType: 'png',
})

function handleReset() {
  signCanvasRef.value?.clear()
  signature.value = null
  result.value = null
}
function handleGenerate() {
  const image = signCanvasRef.value?.toDataURL()
  if (!image) {
    useFaToast().warning('画板为空，无法生成图片')
    return
  }
  result.value = image
}
function handleDownload() {
  const image = signCanvasRef.value?.downloadSignImg(Date.now().toString())
  if (!image) {
    useFaToast().warning('画板为空，无法下载图片')
  }
}

function open(url: string) {
  window.open(url, '_blank')
}
</script>

<template>
  <div>
    <Alert />
    <FaPageHeader :title="t('esign')">
      <template #description>
        <Command text="pnpm add sign-canvas" />
      </template>
      <FaButton variant="outline" size="icon" @click="open('https://github.com/langyuxiansheng/vue-sign-canvas')">
        <FaIcon name="i-simple-icons:github" />
      </FaButton>
    </FaPageHeader>
    <FaPageMain>
      <div class="space-y-2">
        <SignCanvas ref="signCanvasRef" v-model="signature" :options="options" />
        <div class="space-x-2">
          <FaButton @click="handleReset">
            {{ t('clean') }}
          </FaButton>
          <FaButton @click="handleGenerate">
            {{ t('generate') }}
          </FaButton>
          <FaButton @click="handleDownload">
            {{ t('download') }}
          </FaButton>
        </div>
        <img v-if="result" :src="result" :width="600" :height="360">
      </div>
    </FaPageMain>
  </div>
</template>
