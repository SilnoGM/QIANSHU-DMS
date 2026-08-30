# QsSalesOrderSelectorModal

`QsSalesOrderSelectorModal` 是基于 `QsGenericModal` 的公共销售订单单选弹窗。它负责搜索入口、候选项展示、单选草稿、分页意图、稳定状态和显式确认，不负责接口请求、权限判断或具体业务写入。

## 数据边界

- 调用方负责从服务端查询 `orderStatus=CONFIRMED` 的销售订单，并传入 `items`、`total`、`page`、`pageSize`、`loading` 和 `error`。
- 组件会再次过滤非 `CONFIRMED` 数据，防止草稿、待对账、已完成或已取消订单误入选择结果。
- 组件使用最小结构类型 `SalesOrderSelectorItem`，与销售订单列表 DTO 保持结构兼容，但不反向依赖生成 API。
- 搜索、重试和翻页只发出事件；调用方完成请求后更新受控属性。

## 核心事件

- `search(keyword)`：提交 NFKC 归一化后的搜索词。
- `pageChange({ page, pageSize })`（模板中使用 `@page-change`）：请求切换分页。
- `select(item)`：候选行发生单选，不关闭弹窗。
- `confirm(item)`：用户显式确认当前选择。
- `cancel()` / `retry()`：取消与重试意图。

组件库页面提供默认、加载、空数据和错误四组本地 fixture，可用于桌面与移动端布局验收。
