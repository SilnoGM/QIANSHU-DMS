# 广告账户充值技术设计

## 1. 设计结论

- **业务归属固定为申请人**：`ADVERTISING_FEE` 类型要求必须有用户，个人分摊人就是提交申请的人，客户端不能指定 `userId`、比例或资金规则。
- **申请单是资金事实的一部分**：单号、账户信息、申请金额、二维码提交后不可改；付款金额、付款截图、付款人与资金批次一次写入；已付款只能整单作废并反向冲正。
- **不改既有资金规则**：`ADVERTISING_FEE`（COST / DEBIT，`USER_SHARE` + `COMPANY_REMAINDER`）保持已发布版本与启用状态，只新增业务来源 `ADVERTISING_RECHARGE` 并绑定到它。
- **读写权限按范围拆分**：`read-self` 与 `read` 是两个权限码，运营只看本人、财务看全部；不依赖数据范围服务在运行时兜底。
- **媒体用途独立**：收款二维码与付款截图各自一个 `upload_purpose`，不与其他域凭证互相复用。

不采用的方案：

- 复用提款申请：字段、状态、分摊方向和金额来源都不同，且提款只有单腿扣款。
- 新建独立的「广告费报销」通用单据：本期只有一个业务类型，抽象成本高于收益。
- 在申请单上允许改金额重付：会破坏资金事实与审计链，改为作废 + 重新提交。

## 2. 数据模型

### 2.1 主表 `advertising_recharge_requests`

| 分组 | 列 |
|---|---|
| 单据 | `id`、`recharge_no`（唯一）、`numbering_issuance_id`（唯一） |
| 申请 | `applicant_user_id`、`account_type`、`ad_account_name`、`ad_account_no`、`recharge_amount`、`recharge_currency`、`payment_qr_media_asset_id`（唯一）、`remark` |
| 状态 | `status`、`submitted_at`、`version` |
| 付款 | `payment_amount_cny`、`payment_proof_media_asset_id`（唯一）、`paid_at`、`paid_by_user_id`、`fund_posting_batch_id`（唯一） |
| 驳回 | `reviewed_at`、`reviewed_by_user_id`、`reject_reason` |
| 撤回 | `withdrawn_at` |
| 作废 | `voided_at`、`voided_by_user_id`、`void_reason`、`fund_reversal_batch_id`（唯一） |
| 幂等/审计 | `request_key_hash`、`created_at`、`updated_at` |

唯一性约束的业务含义：

- `payment_qr_media_asset_id` / `payment_proof_media_asset_id`：同一张图片不能被两张申请复用。
- `fund_posting_batch_id` / `fund_reversal_batch_id`：一个资金批次只能服务一张申请。
- `(applicant_user_id, request_key_hash)`：同一幂等键只产生一张申请。

### 2.2 枚举

- `advertising_account_type`：`PERSONAL`、`NON_PERSONAL`
- `advertising_recharge_status`：`PENDING`、`PAID`、`REJECTED`、`WITHDRAWN`、`VOIDED`

### 2.3 数据库不变量

| 约束/触发器 | 作用 |
|---|---|
| `advertising_recharge_requests_amount_positive_check` | 充值金额 > 0 且两位小数 |
| `advertising_recharge_requests_currency_check` | 只允许 `CNY`、`USD` |
| `advertising_recharge_requests_qr_shape_check` | 个人户必须有二维码；非个人户必须没有 |
| `advertising_recharge_requests_status_shape_check` | 每个状态只允许一组字段形状；作废保留原付款事实 |
| `enforce_advertising_recharge_number_identity` | 单号必须来自 `ADVERTISING_RECHARGE_NO` 的 `ADVERTISING_RECHARGE.CREATE` 派发 |
| `enforce_advertising_recharge_transition` | 身份字段不可变、`version` 只能 +1、只允许单向流转、作废不得改付款事实、禁止 DELETE |
| `enforce_ready_media_asset_reference`（扩展） | 两张图片必须保持 READY 且用途/图片形状正确，申请单不可删除 |

## 3. 资金链路

```text
pay 事务
  ├─ 锁申请行（SELECT … FOR UPDATE）
  ├─ 校验收款码/付款截图并激活媒体
  ├─ fund.lockBusinessEventAccountsInTransaction（锁个人+公司账户）
  ├─ fund.previewBusinessEventInTransaction（读取规则与比例快照）
  ├─ fund.postBusinessEventInTransaction（写入批次与两条分录）
  ├─ 更新申请为 PAID（金额、凭证、付款人、批次、version+1）
  └─ 写审计 ADVERTISING_RECHARGE_PAID
```

- 来源：`ADVERTISING_RECHARGE`；业务类型：`ADVERTISING_FEE`；消费码：`ADVERTISING_RECHARGE.PAY`。
- 过账金额 = 财务实付 CNY；`userId` = 申请人。
- 作废：`reverseBusinessEventInTransaction`，消费码 `ADVERTISING_RECHARGE.VOID`，全额反向，幂等键 `advertising-recharge:{id}:void`。
- 资金域在 `CONTROLLED_POSTING_TYPE_BY_SOURCE_CONSUMER` 与 `normalizeBusinessContext` 两处显式登记新来源，不允许业务域直接调用 `postBusinessEvent`。
- 批次形状 CHECK 只放行正向 `PAY`（金额 > 0）与负向 `VOID`（金额 < 0），且必须带用户与完整比例快照。

## 4. 提交前置条件

提交前校验申请人有 `USER` 资金账户且 `user_share_rate` 非空，缺少时返回 `ADVERTISING_RECHARGE_ACCOUNT_UNAVAILABLE`。这样配置问题在运营侧立刻暴露，而不是财务付款时才失败；付款时资金域仍会二次校验。

## 5. 幂等与并发

- 创建：`Idempotency-Key`（UUID）+ `pg_advisory_xact_lock`（按申请人 + key 串行）+ `(applicant_user_id, request_key_hash)` 唯一索引。
- 重复提交时逐字段比对，内容一致返回原单，不一致返回 `ADVERTISING_RECHARGE_IDEMPOTENCY_CONFLICT`。
- 付款/驳回/作废/撤回：行锁 + `expectedVersion`，不一致返回 `ADVERTISING_RECHARGE_STATE_CHANGED`。
- 编号指纹绑定全部不可变申请内容，避免同一幂等键生成内容不同的单号。

## 6. 审计

| 事件 | 触发 |
|---|---|
| `ADVERTISING_RECHARGE_SUBMITTED` | 提交成功 |
| `ADVERTISING_RECHARGE_PAID` | 付款并入账 |
| `ADVERTISING_RECHARGE_REJECTED` | 财务驳回 |
| `ADVERTISING_RECHARGE_WITHDRAWN` | 运营撤回 |
| `ADVERTISING_RECHARGE_VOIDED` | 作废并冲正 |

## 7. 资金流水展示

付款批次的来源描述符：主体 = 申请人姓名、动作 = 「广告账户充值」、单号 = 申请单号、明细 = 广告账户名称与充值金额/币种、跳转目标 = `ADVERTISING_RECHARGE` + 申请 id。资金流水列表按既有分组规则展示，不需要额外页面。
