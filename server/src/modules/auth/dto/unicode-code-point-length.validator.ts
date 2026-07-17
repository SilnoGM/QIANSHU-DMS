import {
  type ValidationArguments,
  type ValidationOptions,
  ValidateBy,
} from 'class-validator'

const IS_UNICODE_CODE_POINT_LENGTH = 'isUnicodeCodePointLength'

/**
 * 按 Unicode code point 而不是 UTF-16 code unit 计算字符串长度。
 *
 * JavaScript 的 `String.length` 会把常见 emoji 计作两个 code unit，直接用于 API
 * 边界会错误拒绝合法输入。这里使用字符串迭代器计数，并且不做 trim、normalize 或
 * 任何值转换；规范化与密码策略仍由业务层负责。
 */
export function IsUnicodeCodePointLength(
  minimum: number,
  maximum: number,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  if (
    !Number.isSafeInteger(minimum) ||
    !Number.isSafeInteger(maximum) ||
    minimum < 0 ||
    maximum < minimum
  ) {
    throw new Error('Invalid Unicode code-point length bounds')
  }

  return ValidateBy(
    {
      name: IS_UNICODE_CODE_POINT_LENGTH,
      constraints: [minimum, maximum],
      validator: {
        validate(value: unknown): boolean {
          // 字段类型由 @IsString 单独报告，避免同一个类型错误产生两条重复消息。
          if (typeof value !== 'string') {
            return true
          }

          const codePointLength = [...value].length
          return codePointLength >= minimum && codePointLength <= maximum
        },
        defaultMessage(args: ValidationArguments): string {
          const [minimumLength, maximumLength] = args.constraints as [
            number,
            number,
          ]

          return `${args.property} must contain between ${minimumLength} and ${maximumLength} Unicode code points`
        },
      },
    },
    validationOptions,
  )
}
