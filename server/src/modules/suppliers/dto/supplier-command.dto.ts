import { Type } from 'class-transformer'
import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger'
import {
  IsDefined,
  IsEnum,
  IsInt,
  IsObject,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

import {
  SupplierEntityType,
  type SupplierEntityType as SupplierEntityTypeValue,
} from '../../../generated/prisma/enums'
import { supplierTextValidators } from '../supplier.normalizer'

const MAX_INT32 = 2_147_483_647

function IsNormalizableSupplierText(
  kind: keyof typeof supplierTextValidators,
  message: string,
): PropertyDecorator {
  return ValidateBy({
    name: `isNormalizableSupplier${kind}`,
    validator: {
      validate: supplierTextValidators[kind],
      defaultMessage: () => message,
    },
  })
}

export class SupplierRegistrationInputDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsDefined({ message: '必须提交登记国家或地区' })
  @IsUUID(undefined, { message: '必须是有效的 UUID' })
  countryRegionId!: string

  @ApiProperty({ type: 'string', description: '规范化后长度 1..64' })
  @IsDefined({ message: '必须提交登记号' })
  @IsString({ message: '必须是字符串' })
  @IsNormalizableSupplierText(
    'registrationNumber',
    '规范化后长度必须为 1 到 64 个字符',
  )
  number!: string
}

export class SupplierPrimaryContactInputDto {
  @ApiProperty({ type: 'string', nullable: true })
  @IsDefined({ message: '必须明确提交联系人姓名，清空使用 null' })
  @ValidateIf((_object: object, value: unknown) => value !== null)
  @IsString({ message: '必须是字符串或 null' })
  @IsNormalizableSupplierText('contactName', '规范化后长度不能超过 128 个字符')
  name!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  @IsDefined({ message: '必须明确提交联系人电话，清空使用 null' })
  @ValidateIf((_object: object, value: unknown) => value !== null)
  @IsString({ message: '必须是字符串或 null' })
  @IsNormalizableSupplierText('contactPhone', '规范化后长度不能超过 32 个字符')
  phone!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  @IsDefined({ message: '必须明确提交联系人微信号，清空使用 null' })
  @ValidateIf((_object: object, value: unknown) => value !== null)
  @IsString({ message: '必须是字符串或 null' })
  @IsNormalizableSupplierText('contactWechatId', '规范化后长度不能超过 64 个字符')
  wechatId!: string | null
}

export class SupplierPrimaryAddressInputDto {
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  @IsDefined({ message: '必须明确提交国家或地区，清空使用 null' })
  @ValidateIf((_object: object, value: unknown) => value !== null)
  @IsUUID(undefined, { message: '必须是有效的 UUID 或 null' })
  countryRegionId!: string | null

  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  @IsDefined({ message: '必须明确提交省或州，清空使用 null' })
  @ValidateIf((_object: object, value: unknown) => value !== null)
  @IsUUID(undefined, { message: '必须是有效的 UUID 或 null' })
  provinceStateId!: string | null

  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  @IsDefined({ message: '必须明确提交城市，清空使用 null' })
  @ValidateIf((_object: object, value: unknown) => value !== null)
  @IsUUID(undefined, { message: '必须是有效的 UUID 或 null' })
  cityId!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  @IsDefined({ message: '必须明确提交详细地址，清空使用 null' })
  @ValidateIf((_object: object, value: unknown) => value !== null)
  @IsString({ message: '必须是字符串或 null' })
  @IsNormalizableSupplierText('addressLine', '规范化后长度不能超过 500 个字符')
  addressLine!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  @IsDefined({ message: '必须明确提交邮编，清空使用 null' })
  @ValidateIf((_object: object, value: unknown) => value !== null)
  @IsString({ message: '必须是字符串或 null' })
  @IsNormalizableSupplierText('postalCode', '规范化后长度不能超过 32 个字符')
  postalCode!: string | null
}

abstract class SupplierMutableFieldsDto {
  @ApiProperty({ type: 'string', description: '规范化后长度 1..200' })
  @IsString({ message: '必须是字符串' })
  @IsNormalizableSupplierText('legalName', '规范化后长度必须为 1 到 200 个字符')
  legalName!: string

  @ApiPropertyOptional({ type: 'string', nullable: true })
  @ValidateIf((_object: object, value: unknown) => value !== undefined && value !== null)
  @IsString({ message: '必须是字符串或 null' })
  @IsNormalizableSupplierText('shortName', '规范化后长度不能超过 100 个字符')
  shortName?: string | null

  @ApiProperty({ type: 'string', enum: SupplierEntityType })
  @IsEnum(SupplierEntityType, { message: '必须是有效的供应商主体类型' })
  entityType!: SupplierEntityTypeValue

  @ApiPropertyOptional({ type: SupplierRegistrationInputDto, nullable: true })
  @ValidateIf((_object: object, value: unknown) => value !== undefined && value !== null)
  @IsObject({ message: '必须是对象或 null' })
  @ValidateNested()
  @Type(() => SupplierRegistrationInputDto)
  registration?: SupplierRegistrationInputDto | null

  @ApiPropertyOptional({ type: SupplierPrimaryContactInputDto, nullable: true })
  @ValidateIf((_object: object, value: unknown) => value !== undefined && value !== null)
  @IsObject({ message: '必须是对象或 null' })
  @ValidateNested()
  @Type(() => SupplierPrimaryContactInputDto)
  primaryContact?: SupplierPrimaryContactInputDto | null

  @ApiPropertyOptional({ type: SupplierPrimaryAddressInputDto, nullable: true })
  @ValidateIf((_object: object, value: unknown) => value !== undefined && value !== null)
  @IsObject({ message: '必须是对象或 null' })
  @ValidateNested()
  @Type(() => SupplierPrimaryAddressInputDto)
  primaryAddress?: SupplierPrimaryAddressInputDto | null

  @ApiPropertyOptional({ type: 'string', nullable: true })
  @ValidateIf((_object: object, value: unknown) => value !== undefined && value !== null)
  @IsString({ message: '必须是字符串或 null' })
  @IsNormalizableSupplierText('remark', '规范化后长度不能超过 1000 个字符')
  remark?: string | null
}

export class CreateSupplierRequestDto extends SupplierMutableFieldsDto {}

export class UpdateSupplierRequestDto {
  @ApiPropertyOptional({ type: 'string' })
  @ValidateIf((object: UpdateSupplierRequestDto, value: unknown) =>
    value !== undefined || !hasMutableField(object),
  )
  @IsString({ message: '必须是字符串' })
  @IsNormalizableSupplierText('legalName', '规范化后长度必须为 1 到 200 个字符')
  legalName?: string

  @ApiPropertyOptional({ type: 'string', nullable: true })
  @ValidateIf((_object: object, value: unknown) => value !== undefined && value !== null)
  @IsString({ message: '必须是字符串或 null' })
  @IsNormalizableSupplierText('shortName', '规范化后长度不能超过 100 个字符')
  shortName?: string | null

  @ApiPropertyOptional({ type: 'string', enum: SupplierEntityType })
  @ValidateIf((_object: object, value: unknown) => value !== undefined)
  @IsEnum(SupplierEntityType, { message: '必须是有效的供应商主体类型' })
  entityType?: SupplierEntityTypeValue

  @ApiPropertyOptional({ type: SupplierRegistrationInputDto, nullable: true })
  @ValidateIf((_object: object, value: unknown) => value !== undefined && value !== null)
  @IsObject({ message: '必须是对象或 null' })
  @ValidateNested()
  @Type(() => SupplierRegistrationInputDto)
  registration?: SupplierRegistrationInputDto | null

  @ApiPropertyOptional({ type: SupplierPrimaryContactInputDto, nullable: true })
  @ValidateIf((_object: object, value: unknown) => value !== undefined && value !== null)
  @IsObject({ message: '必须是对象或 null' })
  @ValidateNested()
  @Type(() => SupplierPrimaryContactInputDto)
  primaryContact?: SupplierPrimaryContactInputDto | null

  @ApiPropertyOptional({ type: SupplierPrimaryAddressInputDto, nullable: true })
  @ValidateIf((_object: object, value: unknown) => value !== undefined && value !== null)
  @IsObject({ message: '必须是对象或 null' })
  @ValidateNested()
  @Type(() => SupplierPrimaryAddressInputDto)
  primaryAddress?: SupplierPrimaryAddressInputDto | null

  @ApiPropertyOptional({ type: 'string', nullable: true })
  @ValidateIf((_object: object, value: unknown) => value !== undefined && value !== null)
  @IsString({ message: '必须是字符串或 null' })
  @IsNormalizableSupplierText('remark', '规范化后长度不能超过 1000 个字符')
  remark?: string | null

  @ApiProperty({ type: 'integer', minimum: 1, maximum: MAX_INT32 })
  @IsInt({ message: '必须是整数' })
  @Min(1, { message: '不能小于 1' })
  @Max(MAX_INT32, { message: '不能超过 2147483647' })
  expectedVersion!: number
}

function hasMutableField(input: UpdateSupplierRequestDto): boolean {
  return [
    'legalName',
    'shortName',
    'entityType',
    'registration',
    'primaryContact',
    'primaryAddress',
    'remark',
  ].some(field => input[field as keyof UpdateSupplierRequestDto] !== undefined)
}

export class ChangeSupplierStatusRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: MAX_INT32 })
  @IsInt({ message: '必须是整数' })
  @Min(1, { message: '不能小于 1' })
  @Max(MAX_INT32, { message: '不能超过 2147483647' })
  expectedVersion!: number
}

export const UPDATE_SUPPLIER_REQUEST_BODY_SCHEMA = {
  allOf: [
    { $ref: getSchemaPath(UpdateSupplierRequestDto) },
    {
      anyOf: [
        { required: ['legalName'] },
        { required: ['shortName'] },
        { required: ['entityType'] },
        { required: ['registration'] },
        { required: ['primaryContact'] },
        { required: ['primaryAddress'] },
        { required: ['remark'] },
      ],
    },
  ],
}
