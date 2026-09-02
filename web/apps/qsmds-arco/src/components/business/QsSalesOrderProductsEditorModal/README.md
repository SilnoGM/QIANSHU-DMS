# QsSalesOrderProductsEditorModal

`QsSalesOrderProductsEditorModal` 是海运前销售订单产品修改的纯业务弹窗。它展示服务端
提供的当前产品、有效采购锁定和金额事实；既有行只允许调整数量，新增行复用
`QsOrderProductLineEditor`。

组件不读取 API 或账户 Store。调用方负责加载上下文、产品选项、提交 mutation、错误
恢复和成功刷新；组件只通过 props 接收草稿并发出更新、校验失败、复核和确认事件。

数量减少到 `0` 表示业务软移除。存在有效采购事实的既有行，最小数量固定为原数量。
金额预览使用四位定点运算，但不作为服务端可信输入。若新总价低于原定金，唯一确认
视图切换为 amber 风险语义，并仅在此视图发出 `confirmDepositReduction: true`。
