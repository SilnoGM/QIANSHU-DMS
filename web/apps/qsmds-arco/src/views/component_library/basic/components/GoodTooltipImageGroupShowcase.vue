<script setup lang="ts">
import type { ImageGroupItem } from '@/components/base/ImageGroup/types'
import type { GoodTooltipImageFit } from '@/components/business/QsGoodTooltip/types'
import productDetail from '@/assets/images/component-library/image-group/product-detail.svg'
import productFront from '@/assets/images/component-library/image-group/product-front.svg'
import productLabel from '@/assets/images/component-library/image-group/product-label.svg'
import productSide from '@/assets/images/component-library/image-group/product-side.svg'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import QsGoodTooltipContent from '@/components/business/QsGoodTooltip/QsGoodTooltipContent.vue'

defineOptions({ name: 'GoodTooltipImageGroupShowcase' })

interface GoodTooltipExample {
  code: string
  description: string
  imageFit: GoodTooltipImageFit
  kind: 'SKU' | 'SPU'
  name: string
}

type ProductImageItem = ImageGroupItem & { key: string }

const productImages: readonly ProductImageItem[] = [
  {
    alt: '城市旅行收纳包产品正面',
    key: 'spu:SPU-BAG-202607-014',
    src: productFront,
    tooltip: '城市旅行收纳包 SPU-BAG-202607-014',
  },
  {
    alt: '墨蓝色中号旅行收纳包侧面',
    key: 'sku:SKU-BAG-NV-M-041',
    src: productSide,
    tooltip: '墨蓝中号旅行收纳包 SKU-BAG-NV-M-041',
  },
  {
    alt: '沙棕色大号旅行收纳包标签',
    key: 'sku:SKU-BAG-SD-L-052',
    src: productLabel,
    tooltip: '沙棕大号旅行收纳包 SKU-BAG-SD-L-052',
  },
  {
    alt: '通勤分区收纳包内部结构',
    key: 'spu:SPU-BAG-202607-029',
    src: productDetail,
    tooltip: '通勤分区收纳包 SPU-BAG-202607-029',
  },
]

const goodByImageKey = new Map<string, GoodTooltipExample>([
  ['spu:SPU-BAG-202607-014', {
    code: 'SPU-BAG-202607-014',
    description: '旅行收纳 · 标准商品',
    imageFit: 'cover',
    kind: 'SPU',
    name: '城市旅行收纳包',
  }],
  ['sku:SKU-BAG-NV-M-041', {
    code: 'SKU-BAG-NV-M-041',
    description: '墨蓝 / 中号 / 防泼水',
    imageFit: 'contain',
    kind: 'SKU',
    name: '墨蓝中号旅行收纳包',
  }],
  ['sku:SKU-BAG-SD-L-052', {
    code: 'SKU-BAG-SD-L-052',
    description: '沙棕 / 大号 / 可扩容',
    imageFit: 'contain',
    kind: 'SKU',
    name: '沙棕大号旅行收纳包',
  }],
  ['spu:SPU-BAG-202607-029', {
    code: 'SPU-BAG-202607-029',
    description: '通勤收纳 · 新品',
    imageFit: 'cover',
    kind: 'SPU',
    name: '通勤分区收纳包',
  }],
])

function resolveGoodByImage(item: ImageGroupItem): GoodTooltipExample | undefined {
  // ImageGroup 会保留调用方原始 item；使用显式 key 可避免过滤、排序后 index 变化导致产品串项。
  if (item.key === undefined) {
    return undefined
  }
  return goodByImageKey.get(String(item.key))
}

const mappedGoods = productImages.flatMap((item) => {
  const good = resolveGoodByImage(item)
  return good ? [{ good, item }] : []
})
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
            一张图片，对应一条产品信息
          </h3>
          <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-2xl">
            ImageGroup 继续管理逐图 hover、键盘焦点和整组预览；调用方按图片 key 提供对应的 SPU / SKU 内容。
          </p>
        </div>
        <FaTag variant="outline">
          ImageGroup × QsGoodTooltipContent
        </FaTag>
      </div>

      <div class="mt-7 border border-border rounded-xl bg-muted/15 overflow-hidden lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(18rem,1.1fr)]">
        <section class="p-5 sm:p-6" aria-labelledby="good-tooltip-image-group-demo-title">
          <div>
            <h4 id="good-tooltip-image-group-demo-title" class="text-base font-semibold m-0">
              逐图查看产品
            </h4>
            <p class="text-xs text-muted-foreground leading-5 m-0 mt-1">
              hover 任一缩略图，或聚焦后使用方向键切换；点击仍打开原有整组预览。
            </p>
          </div>

          <div class="mt-8 flex flex-wrap gap-5 items-center justify-between">
            <ImageGroup
              :items="productImages"
              :max-count="productImages.length"
              radius="lg"
              size="lg"
            >
              <template #tooltip="{ item, index, total }">
                <QsGoodTooltipContent
                  :image-src="item.src"
                  :image-alt="item.alt"
                  :image-fit="resolveGoodByImage(item)?.imageFit ?? 'cover'"
                >
                  <template v-if="resolveGoodByImage(item)">
                    <div class="min-w-0">
                      <div class="flex gap-3 items-center justify-between">
                        <span class="tracking-[0.12em] font-semibold">
                          {{ resolveGoodByImage(item)?.kind }}
                        </span>
                        <span class="opacity-60 tabular-nums">
                          {{ index + 1 }} / {{ total }}
                        </span>
                      </div>
                      <p class="text-sm leading-5 font-semibold m-0 mt-2">
                        {{ resolveGoodByImage(item)?.name }}
                      </p>
                      <p class="font-mono m-0 mt-1 opacity-70 break-all">
                        {{ resolveGoodByImage(item)?.code }}
                      </p>
                      <p class="m-0 mt-2 pt-2 border-t border-background/15 opacity-75">
                        {{ resolveGoodByImage(item)?.description }}
                      </p>
                    </div>
                  </template>
                  <div v-else class="min-w-0">
                    <p class="text-sm leading-5 font-semibold m-0">
                      该图片暂未关联 SPU / SKU
                    </p>
                    <p class="m-0 mt-1 opacity-70">
                      请检查调用方的图片 key 与产品映射。
                    </p>
                  </div>
                </QsGoodTooltipContent>
              </template>
            </ImageGroup>

            <span class="text-xs text-muted-foreground text-right">
              4 张图片<br>4 条独立映射
            </span>
          </div>
        </section>

        <aside
          class="p-5 border-t border-border bg-background/60 sm:p-6 lg:border-l lg:border-t-0"
          aria-labelledby="good-tooltip-image-map-title"
        >
          <div class="flex gap-3 items-start justify-between">
            <div>
              <h4 id="good-tooltip-image-map-title" class="text-base font-semibold m-0">
                当前映射
              </h4>
              <p class="text-xs text-muted-foreground m-0 mt-1">
                关键信息保持常驻，触屏不依赖 hover。
              </p>
            </div>
            <span class="text-xs text-primary font-medium">item.key</span>
          </div>

          <ul class="m-0 mt-5 p-0 list-none border-y border-border divide-border divide-y">
            <li
              v-for="({ good, item }, index) in mappedGoods"
              :key="item.key"
              class="py-3 gap-3 grid grid-cols-[1.8rem_minmax(0,1fr)] items-start"
            >
              <span class="text-xs text-muted-foreground font-mono tabular-nums">
                {{ String(index + 1).padStart(2, '0') }}
              </span>
              <span class="min-w-0">
                <span class="text-sm font-medium flex gap-2 items-center">
                  <span>{{ good.name }}</span>
                  <span class="text-[0.625rem] text-muted-foreground px-1.5 py-0.5 border border-border rounded">
                    {{ good.kind }}
                  </span>
                </span>
                <span class="text-xs text-muted-foreground font-mono mt-1 block break-all">
                  {{ good.code }}
                </span>
              </span>
            </li>
          </ul>
        </aside>
      </div>

      <div class="mt-5 pt-5 border-t border-border flex flex-wrap gap-3 items-center justify-between">
        <p class="text-xs text-muted-foreground m-0">
          ImageGroup 保留内置 FaTooltip；QsGoodTooltipContent 只替换每张图片的内容层，不创建嵌套浮层。
        </p>
        <span class="text-xs text-primary font-medium">稳定 key 决定产品映射</span>
      </div>
    </div>
  </section>
</template>
