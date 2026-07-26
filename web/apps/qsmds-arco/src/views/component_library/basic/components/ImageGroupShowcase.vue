<script setup lang="ts">
import type {
  ImageGroupFit,
  ImageGroupItem,
  ImageGroupRadius,
} from '@/components/base/ImageGroup/types'
import productDetail from '@/assets/images/component-library/image-group/product-detail.svg'
import productFront from '@/assets/images/component-library/image-group/product-front.svg'
import productLabel from '@/assets/images/component-library/image-group/product-label.svg'
import productPackage from '@/assets/images/component-library/image-group/product-package.svg'
import productSide from '@/assets/images/component-library/image-group/product-side.svg'
import ImageGroup from '@/components/base/ImageGroup/index.vue'

defineOptions({ name: 'ImageGroupShowcase' })

const productImages: readonly ImageGroupItem[] = [
  {
    alt: '墨蓝色旅行收纳包正面',
    key: 'front',
    previewSrc: productFront,
    src: productFront,
    tooltip: '产品正面图',
  },
  {
    alt: '旅行收纳包侧面',
    key: 'side',
    src: productSide,
    tooltip: '产品侧面图',
  },
  {
    alt: '旅行收纳包内部隔层',
    key: 'detail',
    src: productDetail,
    tooltip: '内部隔层',
  },
  {
    alt: '产品包装箱',
    key: 'package',
    src: productPackage,
    tooltip: '产品包装',
  },
  {
    alt: '产品标签细节',
    key: 'label',
    src: productLabel,
    tooltip: '标签细节',
  },
]

const brokenImages: readonly ImageGroupItem[] = [
  productImages[0]!,
  {
    alt: '无法加载的产品图片',
    key: 'broken',
    src: '/component-library/image-group/missing-product-image.png',
    tooltip: '失效图片',
  },
]

const radiusOptions: readonly {
  label: string
  value: ImageGroupRadius
}[] = [
  { label: '无圆角', value: 'none' },
  { label: '小', value: 'sm' },
  { label: '中', value: 'md' },
  { label: '大', value: 'lg' },
  { label: '圆形', value: 'full' },
  { label: '12px', value: 12 },
]

const selectedRadius = ref<ImageGroupRadius>('lg')
const selectedFit = ref<ImageGroupFit>('cover')
</script>

<template>
  <section aria-labelledby="image-group-showcase-title">
    <div class="p-5 border border-border rounded-xl bg-background sm:p-7">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div class="min-w-0">
          <div class="text-primary flex gap-2 items-center">
            <FaIcon name="i-lucide:images" class="size-5" />
            <span class="text-xs tracking-[0.16em] font-semibold">媒体展示组件</span>
          </div>
          <h3 id="image-group-showcase-title" class="text-xl tracking-tight font-semibold m-0 mt-3 sm:text-2xl">
            在有限宽度中辨认每一张图片
          </h3>
          <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-2xl">
            图片保持紧凑堆叠，hover 或键盘聚焦显示对应提示；点击任意缩略图会从准确索引进入整组预览。
          </p>
        </div>
        <FaTag variant="secondary">
          ImageGroup
        </FaTag>
      </div>

      <div class="mt-7 gap-8 grid lg:grid-cols-[minmax(0,1.45fr)_minmax(17rem,0.7fr)]">
        <div class="min-w-0">
          <div class="pb-4 border-b border-border">
            <h4 class="text-base font-semibold m-0">
              圆角与裁切
            </h4>
            <p class="text-xs text-muted-foreground m-0 mt-1">
              预设值消费项目圆角 Token，数字值按像素处理。
            </p>
          </div>

          <div class="py-6 border-b border-border gap-7 grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <ImageGroup
              :items="productImages"
              :radius="selectedRadius"
              :fit="selectedFit"
              :max-count="4"
              size="lg"
            />

            <div class="flex flex-wrap gap-2 sm:max-w-80 sm:justify-end">
              <FaButton
                v-for="option in radiusOptions"
                :key="String(option.value)"
                size="sm"
                :variant="selectedRadius === option.value ? 'default' : 'outline'"
                @click="selectedRadius = option.value"
              >
                {{ option.label }}
              </FaButton>
            </div>
          </div>

          <div class="py-5 flex flex-wrap gap-3 items-center justify-between">
            <div>
              <p class="text-sm font-semibold m-0">
                图片适配
              </p>
              <p class="text-xs text-muted-foreground m-0 mt-1">
                cover 适合产品主图；contain 保留完整轮廓。
              </p>
            </div>
            <div class="flex gap-2">
              <FaButton
                size="sm"
                :variant="selectedFit === 'cover' ? 'secondary' : 'ghost'"
                @click="selectedFit = 'cover'"
              >
                Cover
              </FaButton>
              <FaButton
                size="sm"
                :variant="selectedFit === 'contain' ? 'secondary' : 'ghost'"
                @click="selectedFit = 'contain'"
              >
                Contain
              </FaButton>
            </div>
          </div>
        </div>

        <aside class="p-5 border border-border rounded-xl bg-muted/20 self-start">
          <p class="text-xs text-primary tracking-[0.16em] font-semibold m-0">
            表格默认值
          </p>
          <dl class="text-sm m-0 mt-5 space-y-4">
            <div class="pb-4 border-b border-border flex gap-4 items-center justify-between">
              <dt class="text-muted-foreground">
                size
              </dt>
              <dd class="font-mono m-0">
                40px
              </dd>
            </div>
            <div class="pb-4 border-b border-border flex gap-4 items-center justify-between">
              <dt class="text-muted-foreground">
                maxCount
              </dt>
              <dd class="font-mono m-0">
                4
              </dd>
            </div>
            <div class="pb-4 border-b border-border flex gap-4 items-center justify-between">
              <dt class="text-muted-foreground">
                overlap
              </dt>
              <dd class="font-mono m-0">
                25%
              </dd>
            </div>
            <div class="flex gap-4 items-center justify-between">
              <dt class="text-muted-foreground">
                tooltip
              </dt>
              <dd class="font-mono m-0">
                300ms
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      <div class="mt-8 pt-7 border-t border-border">
        <div class="flex flex-wrap gap-3 items-end justify-between">
          <div>
            <h4 class="text-base font-semibold m-0">
              数量与失败边界
            </h4>
            <p class="text-xs text-muted-foreground m-0 mt-1">
              单图、多图、溢出、失效和空值都保持稳定占位。
            </p>
          </div>
          <span class="text-xs text-muted-foreground">支持方向键切换</span>
        </div>

        <div class="mt-4 border-y border-border divide-border divide-y">
          <div class="py-5 gap-4 grid items-center sm:grid-cols-[8rem_minmax(0,1fr)]">
            <span class="text-sm font-medium">单张图片</span>
            <ImageGroup :items="productImages.slice(0, 1)" radius="lg" />
          </div>
          <div class="py-5 gap-4 grid items-center sm:grid-cols-[8rem_minmax(0,1fr)]">
            <span class="text-sm font-medium">多图与溢出</span>
            <ImageGroup :items="productImages" :max-count="4" radius="lg" />
          </div>
          <div class="py-5 gap-4 grid items-center sm:grid-cols-[8rem_minmax(0,1fr)]">
            <span class="text-sm font-medium">加载失败</span>
            <ImageGroup :items="brokenImages" radius="lg" />
          </div>
          <div class="py-5 gap-4 grid items-center sm:grid-cols-[8rem_minmax(0,1fr)]">
            <span class="text-sm font-medium">空图片组</span>
            <ImageGroup :items="[]" radius="lg" />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
