<script setup lang="ts">
import type { ImageGroupItem } from '@/components/base/ImageGroup/types'
import productDetail from '@/assets/images/component-library/image-group/product-detail.svg'
import productFront from '@/assets/images/component-library/image-group/product-front.svg'
import productLabel from '@/assets/images/component-library/image-group/product-label.svg'
import productSide from '@/assets/images/component-library/image-group/product-side.svg'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import QsGoodTooltip from '@/components/business/QsGoodTooltip/index.vue'

defineOptions({ name: 'GoodTooltipImageGroupShowcase' })

const spuImages: readonly ImageGroupItem[] = [
  { alt: '墨蓝色旅行收纳包正面', key: 'front', src: productFront },
  { alt: '旅行收纳包侧面', key: 'side', src: productSide },
  { alt: '旅行收纳包内部隔层', key: 'detail', src: productDetail },
]

const skuImages: readonly ImageGroupItem[] = [
  { alt: '墨蓝色中号旅行收纳包正面', key: 'front', src: productFront },
  { alt: '墨蓝色中号旅行收纳包标签', key: 'label', src: productLabel },
]
</script>

<template>
  <section class="mt-8" aria-labelledby="good-tooltip-image-group-title">
    <div class="p-5 border border-border rounded-xl bg-background sm:p-7">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div class="min-w-0">
          <div class="text-primary flex gap-2 items-center">
            <FaIcon name="i-lucide:package-search" class="size-5" />
            <span class="text-xs tracking-[0.16em] font-semibold">业务组合示例</span>
          </div>
          <h3 id="good-tooltip-image-group-title" class="text-xl tracking-tight font-semibold m-0 mt-3 sm:text-2xl">
            图片识别与产品信息各司其职
          </h3>
          <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-2xl">
            ImageGroup 继续管理缩略图和整组预览；外层 QsGoodTooltip 展示当前产品信息，并显式关闭图片组内置提示。
          </p>
        </div>
        <FaTag variant="outline">
          ImageGroup × QsGoodTooltip
        </FaTag>
      </div>

      <div class="mt-7 gap-5 grid md:grid-cols-2">
        <article class="p-5 border border-border rounded-xl bg-muted/15">
          <div class="pb-4 border-b border-border flex gap-3 items-start justify-between">
            <div>
              <p class="text-sm font-semibold m-0">
                SPU 信息
              </p>
              <p class="text-xs text-muted-foreground m-0 mt-1">
                多图对应同一产品
              </p>
            </div>
            <span class="text-xs text-muted-foreground font-mono">SPU-BAG-202607-014</span>
          </div>

          <div class="pt-5 flex gap-4 items-center justify-between">
            <QsGoodTooltip
              :image-src="productFront"
              image-alt="城市旅行收纳包"
              side="right"
            >
              <!-- 原生根节点稳定承接 Tooltip 的 hover / focus 事件；
                   ImageGroup 仍只负责缩略图与内部按钮的预览交互。 -->
              <span
                data-slot="good-tooltip-image-group-trigger"
                tabindex="0"
                aria-label="查看城市旅行收纳包产品信息"
                class="rounded-lg inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
              >
                <ImageGroup
                  :items="spuImages"
                  :tooltip="false"
                  :max-count="3"
                  radius="lg"
                  size="lg"
                />
              </span>

              <template #content>
                <div class="min-w-0">
                  <p class="text-sm leading-5 font-semibold m-0">
                    城市旅行收纳包
                  </p>
                  <p class="font-mono m-0 mt-1 opacity-70 break-all">
                    SPU-BAG-202607-014
                  </p>
                  <p class="m-0 mt-2 pt-2 border-t border-background/15 opacity-75">
                    旅行收纳 · 3 张产品图片
                  </p>
                </div>
              </template>
            </QsGoodTooltip>

            <span class="text-xs text-muted-foreground text-right">
              hover / focus<br>查看产品
            </span>
          </div>
        </article>

        <article class="p-5 border border-border rounded-xl bg-muted/15">
          <div class="pb-4 border-b border-border flex gap-3 items-start justify-between">
            <div>
              <p class="text-sm font-semibold m-0">
                SKU 信息
              </p>
              <p class="text-xs text-muted-foreground m-0 mt-1">
                图片组对应明确规格
              </p>
            </div>
            <span class="text-xs text-muted-foreground font-mono">SKU-BAG-NV-M-041</span>
          </div>

          <div class="pt-5 flex gap-4 items-center justify-between">
            <QsGoodTooltip
              :image-src="productFront"
              image-alt="墨蓝色中号旅行收纳包"
              image-fit="contain"
              side="left"
            >
              <span
                data-slot="good-tooltip-image-group-trigger"
                tabindex="0"
                aria-label="查看墨蓝色中号旅行收纳包规格信息"
                class="rounded-lg inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
              >
                <ImageGroup
                  :items="skuImages"
                  :tooltip="false"
                  radius="lg"
                  size="lg"
                />
              </span>

              <template #content>
                <div class="min-w-0">
                  <p class="text-sm leading-5 font-semibold m-0">
                    城市旅行收纳包
                  </p>
                  <p class="font-mono m-0 mt-1 opacity-70 break-all">
                    SKU-BAG-NV-M-041
                  </p>
                  <p class="m-0 mt-2 pt-2 border-t border-background/15 opacity-75">
                    墨蓝 / 中号 / 防泼水
                  </p>
                </div>
              </template>
            </QsGoodTooltip>

            <span class="text-xs text-muted-foreground text-right">
              点击图片<br>继续预览
            </span>
          </div>
        </article>
      </div>

      <div class="mt-5 pt-5 border-t border-border flex flex-wrap gap-3 items-center justify-between">
        <p class="text-xs text-muted-foreground m-0">
          两个 ImageGroup 均设置 <code class="text-foreground">:tooltip="false"</code>，同一触发区域只保留一个 Tooltip。
        </p>
        <span class="text-xs text-primary font-medium">调用方决定提示类型</span>
      </div>
    </div>
  </section>
</template>
