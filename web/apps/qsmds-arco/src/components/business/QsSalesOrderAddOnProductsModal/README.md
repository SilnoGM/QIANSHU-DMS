# QsSalesOrderAddOnProductsModal

`QsSalesOrderAddOnProductsModal` 是销售订单海运前加购的纯业务组件。组件展示由调用方
加载的可信上下文，只编辑本次新增产品与加购原因，不直接读取或写入 API、Store。

原销售明细只在左侧摘要展示，永远不会进入可编辑 `lines`，因此不能被修改、删除，
也不会重复计入金额增量。第一次操作只执行本地校验并进入二次确认；二次确认后组件
发出规范化 `SalesOrderAddOnIntent`，服务端写入和后续采购同步由业务页面编排。

调用方必须传入销售订单币种目录、采购表单当前供应商和产品分页加载器，并在提交锁
期间保持 `submitting = true`，防止关闭或重复提交。
