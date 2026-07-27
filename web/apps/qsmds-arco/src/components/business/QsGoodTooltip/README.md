# QsGoodTooltip 产品提示

产品提示由两个同目录组件组成：

- `QsGoodTooltip`：完整包装器，使用 `FaTooltip` 管理触发、定位与窄屏方向。
- `QsGoodTooltipContent`：纯内容层，只统一左侧方形图片、失败占位和右侧信息区域，可复用到已有 Tooltip 的内容插槽中。

两者都不读取 API、Store，不接收完整产品 DTO，也不推断 SPU / SKU 字段。

## Props

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `imageSrc` | `string \| null` | `null` | 左侧产品图片地址；空值或加载失败显示稳定占位 |
| `imageAlt` | `string` | `''` | 图片替代文本；右侧已经提供完整名称时可以保持空值 |
| `imageFit` | `'cover' \| 'contain'` | `'cover'` | 图片裁切方式 |
| `delay` | `number` | `300` | Tooltip 显示延迟，单位为毫秒 |
| `side` | `'top' \| 'right' \| 'bottom' \| 'left'` | `'top'` | Tooltip 相对触发器的首选方向；窄屏下 `left` / `right` 自动降级为 `top`，避免横向越界 |
| `align` | `'start' \| 'center' \| 'end'` | `'center'` | Tooltip 对齐方式 |
| `disabled` | `boolean` | `false` | 是否禁用产品提示 |

## Slots

- 默认插槽：`FaTooltip` 的触发器。调用方必须提供单个稳定根节点，并确保该节点可聚焦。
- `content`：右侧产品信息区域。调用方自行组织名称、SPU / SKU 编码、规格、状态等只读内容及其样式。

组件不提供 `good`、`spu`、`sku` 对象属性，也不根据字段名推测业务含义。产品数据结构与展示优先级始终由调用方负责。

## 与 ImageGroup 组合

### 每张图片对应不同 SPU / SKU

`ImageGroup` 已经为每张可见图片提供独立 `FaTooltip`。调用方通过 `#tooltip="{ item }"` 复用 `QsGoodTooltipContent`，再使用稳定的 `item.key` 查找该图片对应的产品：

```vue
<ImageGroup
  :items="productImages"
  :max-count="productImages.length"
>
  <template #tooltip="{ item }">
    <QsGoodTooltipContent
      :image-src="item.src"
      :image-alt="item.alt"
    >
      <template v-if="productByImageKey.get(String(item.key))">
        <!-- 调用方渲染该图片对应的 SPU / SKU 信息。 -->
      </template>
      <span v-else>该图片暂未关联 SPU / SKU</span>
    </QsGoodTooltipContent>
  </template>
</ImageGroup>
```

此模式保留 `ImageGroup` 的默认 `tooltip=true`，且不能在 `#tooltip` 中嵌套 `QsGoodTooltip`。每个条目都应提供字符串化后仍唯一的稳定 `key`；不要按会随过滤、排序改变的 `index` 关联产品。若需要每张图片都能独立 hover，`maxCount` 必须不小于图片数量。

### 整组图片对应同一产品

如果整个图片组只对应同一产品，可以继续使用外层 `QsGoodTooltip`。此时必须关闭内部 Tooltip，避免两个浮层竞争：

```vue
<QsGoodTooltip
  :image-src="productImages[0]?.src"
  image-alt="墨蓝色旅行收纳包"
  side="right"
>
  <ImageGroup
    :items="productImages"
    :tooltip="false"
    tabindex="0"
  />

  <template #content>
    <div class="min-w-0">
      <p class="text-sm font-semibold">
        城市旅行收纳包
      </p>
      <p class="opacity-70">
        SPU: SPU-TRAVEL-001
      </p>
    </div>
  </template>
</QsGoodTooltip>
```

调用方应提供单个稳定根节点作为外层触发器并确保其可聚焦；图片组内部原有的预览和方向键行为仍由 `ImageGroup` 管理。实施到具体页面时应同时验证鼠标 hover、键盘 focus 和图片点击，不能只验证其中一种输入方式。

## 使用边界

- Tooltip 只承载补充说明，产品名称、编码等完成业务任务所必需的信息不能只存在于浮层中。
- `content` 中不放按钮、链接、输入框或选择器；需要交互内容时应改用 `FaPopover` 等可聚焦浮层。
- Reka Tooltip 会忽略触屏的 `pointermove`，因此触屏用户不能依赖 hover 主动打开产品提示。
- 左侧图片使用固定方形区域；地址为空或加载失败时显示占位，不造成内容宽度跳动。
- `QsGoodTooltipContent` 只提供布局，不创建新的 Tooltip；`QsGoodTooltip` 与 `ImageGroup` 内置 `FaTooltip` 不能嵌套。
