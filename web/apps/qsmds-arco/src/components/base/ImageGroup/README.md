# ImageGroup 图片组

`ImageGroup` 是正式应用中的无业务语义基础组件，主要用于表格单元格和窄屏卡片中展示产品主图、附件缩略图等单张或多张图片。

## 底层能力

- 缩略图使用原生 `img`，避免 `FaImagePreview` 的大尺寸和固定 hover 样式改变表格密度。
- 每张可见图片使用 `FaTooltip` 展示对应预览与说明。
- 点击图片复用 `useFaImagePreview().open(srcList, index)` 打开整组预览。
- 组件不读取业务 API、Store，也不认识产品、SKU 等领域字段。

## Props

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `items` | `readonly ImageGroupItem[]` | 必填 | 已按展示优先级排序的图片 |
| `size` | `'sm' \| 'md' \| 'lg' \| number` | `'md'` | 32、40、48px 或 24–96px 数字 |
| `radius` | `'none' \| 'sm' \| 'md' \| 'lg' \| 'full' \| number` | `'md'` | 项目圆角预设或非负像素值 |
| `maxCount` | `number` | `4` | 最大可见位置数，`+N` 也占一个位置 |
| `overlap` | `number` | 图片尺寸的 25% | 相邻图片重叠像素 |
| `fit` | `'cover' \| 'contain'` | `'cover'` | 图片填充方式 |
| `preview` | `boolean` | `true` | 是否允许点击打开整组预览 |
| `tooltip` | `boolean` | `true` | 是否启用每张图片的 Tooltip |
| `tooltipDelay` | `number` | `300` | Tooltip 显示延迟 |

```ts
export interface ImageGroupItem {
  alt?: string
  key?: number | string
  previewSrc?: string
  src: string
  tooltip?: string
}
```

`src` 用于缩略图和 Tooltip；`previewSrc` 可指向更高清的预览地址。空白 `src` 会被忽略，其余字段和值保持调用方原样。

## Slots 与 Events

- `tooltip`：覆盖单张图片的 Tooltip 内容，作用域参数为 `{ item, index, total }`。
- `empty`：覆盖无有效图片时的 `—`。
- `error`：覆盖单张图片加载失败状态。
- `preview`：成功打开预览时返回 `{ item, index }`。
- `imageError`：缩略图加载失败时返回 `{ item, index }`。

## QsGenericTable 接入

领域页面先把自己的图片结构映射成 `ImageGroupItem[]`，再通过现有单元格插槽组合：

```vue
<template #cell-images="{ row }">
  <ImageGroup
    :items="row.original.images"
    :max-count="4"
    radius="lg"
  />
</template>
```

图片列建议使用 `width: 160`。移动卡片继续在 `mobile-row` 插槽中使用同一个组件：

```vue
<template #mobile-row="{ row }">
  <ImageGroup :items="row.images" radius="lg" />
</template>
```

## 产品提示组合

`ImageGroup` 不决定业务提示类型，调用方按产品与图片的对应关系选择组合方式。

### 每张图片对应不同 SPU / SKU

保留内置 `FaTooltip`，通过逐项 `tooltip` 插槽复用不含浮层的 `QsGoodTooltipContent`。映射必须使用每张图片显式、稳定且字符串化后仍唯一的 `item.key`：

```vue
<ImageGroup
  :items="row.images"
  :max-count="row.images.length"
  radius="lg"
>
  <template #tooltip="{ item }">
    <QsGoodTooltipContent
      :image-src="item.src"
      :image-alt="item.alt"
    >
      <template v-if="productByImageKey.get(String(item.key))">
        <!-- 渲染该图片对应的 SPU / SKU 名称、编码和规格。 -->
      </template>
      <span v-else>该图片暂未关联 SPU / SKU</span>
    </QsGoodTooltipContent>
  </template>
</ImageGroup>
```

此模式不能传入 `:tooltip="false"`，也不能在 `tooltip` 插槽中嵌套自带 `FaTooltip` 的 `QsGoodTooltip`。不要按 `index` 映射产品：空地址过滤或排序变化会改变索引。严格要求每张图片都能 hover 时，`maxCount` 不得小于图片数量，因为 `+N` 是聚合入口而不是单图触发器。

### 整组图片对应同一产品

如果整个图片组对应同一产品，由调用方使用外层 `QsGoodTooltip`，并显式关闭内部 Tooltip：

```vue
<QsGoodTooltip
  :image-src="row.mainImage"
  image-alt="产品主图"
  side="right"
>
  <ImageGroup
    :items="row.images"
    :tooltip="false"
    tabindex="0"
    radius="lg"
  />

  <template #content>
    <!-- 调用方自行组织产品名称、SPU / SKU 编码和规格等只读信息。 -->
  </template>
</QsGoodTooltip>
```

普通文本说明也可以由调用方使用外层 `FaTooltip`。同一触发区域不能嵌套多个 Tooltip；`QsGoodTooltipContent` 只是内容层，不会增加嵌套浮层。`ImageGroup` 不导入业务组件，也不增加 `tooltipType`、产品对象或领域字段。

## 交互与边界

- 超过 `maxCount` 时显示 `maxCount - 1` 张真实图片和一个 `+N`；点击 `+N` 从第一张隐藏图片开始预览。
- 组内只有一个 Tab 停靠点，左右方向键、`Home` 和 `End` 用于移动焦点。
- 图片点击会阻止冒泡，避免同时触发表格行点击或选择。
- 加载、失败、溢出和 Tooltip 图片使用相同圆角。
- 组件尊重 `prefers-reduced-motion`，窄屏和触屏仍可直接点击查看整组图片。
