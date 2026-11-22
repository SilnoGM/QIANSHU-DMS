import { ApiException } from '../../infrastructure/http/api.exception'

/** 广告账户域稳定错误码。控制器契约按这些 code 声明失败矩阵。 */

export function adAccountNotFound(): never {
  throw new ApiException(404, 'AD_ACCOUNT_NOT_FOUND', '广告账户不存在')
}

export function adAccountAlreadyAssigned(): never {
  throw new ApiException(409, 'AD_ACCOUNT_ALREADY_ASSIGNED', '该广告账户已绑定其他用户，请确认后改绑')
}

export function adAccountNotAssigned(): never {
  throw new ApiException(409, 'AD_ACCOUNT_NOT_ASSIGNED', '该广告账户当前未绑定用户')
}

export function adAccountAssigneeInvalid(): never {
  throw new ApiException(422, 'AD_ACCOUNT_ASSIGNEE_INVALID', '目标用户不存在或已停用')
}

export function adAccountSyncInProgress(): never {
  throw new ApiException(409, 'AD_ACCOUNT_SYNC_IN_PROGRESS', '同步任务正在执行，请稍后重试')
}

export function adAccountVendorDisabled(): never {
  throw new ApiException(409, 'AD_ACCOUNT_VENDOR_DISABLED', '未配置猎豹开放平台凭据，无法同步')
}

/** 并发改绑：读到的状态与提交时不一致。 */
export function adAccountStateChanged(): never {
  throw new ApiException(409, 'AD_ACCOUNT_STATE_CHANGED', '广告账户状态已变化，请刷新后重试')
}
