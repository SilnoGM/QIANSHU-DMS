# QsPersonDisplay 人员显示组件

`QsPersonDisplay` 是“圆形头像 + 显示名称”的纯展示业务组件，适用于订单出单人、负责人、创建人等人员信息的紧凑展示。

## Props

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `displayName` | `string` | 必填 | 人员显示名称；去除首尾空白后为空时显示“未知人员” |
| `avatarUrl` | `string \| null` | `null` | 头像地址；缺失或加载失败时显示名称的首个可见字符 |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | 头像尺寸，依次为 24px、32px、40px |

## 展示约束

- 组件只负责展示，不负责点击、跳转、人员查询或权限判断，也不读取 API、Store 与人员主数据。
- 显示名称保持单行；调用方限制组件宽度后，超长名称自动截断，悬停可通过 Tooltip 查看完整内容。
- 头像始终为圆形；图片不可用时按 Unicode 字素簇截取一个可见字符，避免拆开 emoji 或组合字符。
- 组件宽度跟随内容，表格或紧凑容器应由调用方提供 `max-width` 或列宽约束。

## 示例

```vue
<QsPersonDisplay
  display-name="林雅婷"
  avatar-url="/assets/avatar-example.png"
  size="md"
/>
```
