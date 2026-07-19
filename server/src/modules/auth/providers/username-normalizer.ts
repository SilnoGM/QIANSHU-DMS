export interface NormalizedUsername {
  /**
   * 写入 User.username 并用于界面展示的稳定值。这里只统一 Unicode 与两端空白，
   * 不改变用户选择的大小写，也不折叠登录名内部空白。
   */
  username: string
  /** 写入 User.usernameNormalized 并用于唯一查询的规范化值。 */
  usernameNormalized: string
}

/**
 * 生成登录名的展示值与唯一查询键。
 *
 * NFC 必须发生在 trim/lowercase 之前，保证组合字符的等价输入落到同一个数据库键；
 * lowercase 使用与运行环境 locale 无关的 Unicode 默认映射，避免部署机器 locale
 * 改变用户名唯一性语义。
 */
export const normalizeUsername = (input: string): NormalizedUsername => {
  const username = input.normalize('NFC').trim()

  return {
    username,
    usernameNormalized: username.toLowerCase(),
  }
}
