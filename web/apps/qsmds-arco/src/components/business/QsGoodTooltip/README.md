# QsGoodTooltip 产品提示

`QsGoodTooltip` 是基于 `FaTooltip` 的只读业务展示组件，用于在产品图片获得鼠标 hover 或键盘焦点时补充 SPU / SKU 信息。组件只统一左侧方形图片和右侧信息区域，不读取 API、Store，也不接收完整产品 DTO。

## Props

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `imageSrc` | `string \| null` | `null` | 左侧产品图片地址；空值或加载失败显示稳定占位 |
| `imageAlt` | `string` | `''` | 图片替代文本；右侧已经提供完整名称时可以保持空值 |
| `imageFit` | `'cover' \| 'contain'` | `'cover'` | 图片裁切方式 |
| `delay` | `number` | `300` | Tooltip 显示延迟，单位为毫秒 |
| `side` | `'top' \| 'right' \| 'bottom' \| 'left'` | `'top'` | Tooltip 相对触发器的方向 |
| `align` | `'start' \| 'center' \| 'end'` | `'center'` | Tooltip 对齐方式 |
| `disabled` | `boolean` | `false` | 是否禁用产品提示 |

## Slots

- 默认插槽：`FaTooltip` 的触发器。调用方必须提供单个稳定根节点，并确保该节点可聚焦。
- `content`：右侧产品信息区域。调用方自行组织名称、SPU / SKU 编码、规格、状态等只读内容及其样式。

组件不提供 `good`、`spu`、`sku` 对象属性，也不根据字段名推测业务含义。产品数据结构与展示优先级始终由调用方负责。

## 与 ImageGroup 组合

`ImageGroup` 默认已经为每张图片提供 `FaTooltip`。外层改用产品提示时必须关闭内部 Tooltip，避免两个浮层竞争：

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

`tabindex="0"` 为整个图片组补充产品提示的键盘入口；图片组内部原有的预览和方向键行为仍由 `ImageGroup` 管理。实施到具体页面时应同时验证鼠标 hover、键盘 focus 和图片点击，不能只验证其中一种输入方式。

## 使用边界

- Tooltip 只承载补充说明，产品名称、编码等完成业务任务所必需的信息不能只存在于浮层中。
- `content` 中不放按钮、链接、输入框或选择器；需要交互内容时应改用 `FaPopover` 等可聚焦浮层。
- Reka Tooltip 会忽略触屏的 `pointermove`，因此触屏用户不能依赖 hover 主动打开产品提示。
- 左侧图片使用固定方形区域；地址为空或加载失败时显示占位，不造成内容宽度跳动。
- 调用方使用普通 `FaTooltip`、`QsGoodTooltip` 或 `ImageGroup` 内置提示三者之一，不嵌套开启多个 Tooltip。
