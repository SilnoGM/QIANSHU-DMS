# QsProductThumbnail

产品缩略图的统一展示组件，供寄仓卡片和详情抽屉共用。

## 契约

- `src`：图片地址；为空表示无图。
- `alt`：产品名称，用于图片替代文本和预览按钮的 aria-label。
- `size`：`sm`（44px）或 `md`（56px）。

## 表现

- 有图：点击复用 `useFaImagePreview` 打开原图，鼠标为 zoom-in。
- 无图：显示 `image-off` 占位。
- 加载失败：卸载 `<img>`，回退为同一占位，附加红色边框和红色底色，不展示破损图片，也不可打开预览。
- `src` 变化时自动清除失败态。
