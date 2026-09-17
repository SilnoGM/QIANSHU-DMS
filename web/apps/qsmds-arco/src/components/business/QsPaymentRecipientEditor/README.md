# QsPaymentRecipientEditor

供应商配置和自定义采购共用的收款资料编辑器。每种方式最多一个账户；不自行保存资料、不操作资金。

- `v-model: PaymentRecipientAccountInputDto[]`：启用的收款方式及草稿。关闭方式即从数组移除。
- `disabled?: boolean`：锁定编辑；上传中也会锁定方式切换和文本字段。
- `minimum?: 0 | 1`：默认 `0`，允许管理员清空；自定义采购传 `1`。
- `busyChange(boolean)`：上传进行中，调用方据此禁止提交、关闭和离开。
- `logic.ts` 导出 `validatePaymentRecipientAccounts(accounts, minimum)`，返回完整 i18n 错误 key 或 `null`。提交前由调用方显式校验。
- `normalizePaymentRecipientAccounts(accounts)` 清理输入空白，并只保留当前方式所需字段。

`PaymentRecipientDetails.vue` 接受 `account: PaymentRecipientAccountInputDto`，只读展示银行资料或完整二维码；支持银行字段/整组复制、二维码放大和下载。

二维码上传复用认证 API 客户端，仅接受 JPG/PNG/WebP、单张不超过 10 MiB。读取始终按媒体 ID 通过认证 Blob 接口；不直接消费 `qrContentUrl`，不把 token 拼进图片 URL。图片对象 URL 在换图、退出身份和卸载时撤销。未提交图片沿用临时媒体过期回收机制。
