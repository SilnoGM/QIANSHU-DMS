# QsSalesOrderProductsEditorModal

`QsSalesOrderProductsEditorModal` 是海运前销售订单产品修改的纯业务弹窗。它展示服务端
提供的当前产品、有效采购锁定和金额事实，并把既有行与新增行统一交给
`QsOrderProductLineEditor` 编辑。

组件不读取 API 或账户 Store。调用方负责加载上下文、产品选项、提交 mutation、错误
恢复和成功刷新；组件只通过 props 接收草稿并发出更新、校验失败、复核和确认事件。

数量减少到 `0` 表示业务软移除。存在有效采购事实的既有行禁止删除、禁止改变产品身份，
数量下限为有效已采购数量；名称、描述、备注和本单售价仍可修改。上述修改只写销售订单
快照，不回写产品档案或既有采购明细。金额预览使用四位定点运算，但不作为服务端可信
输入。若新总价低于原定金，唯一确认视图切换为 amber 风险语义，并仅在此视图发出
`confirmDepositReduction: true`。
