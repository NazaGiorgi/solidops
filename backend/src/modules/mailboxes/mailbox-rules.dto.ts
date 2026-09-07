import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateMailboxRuleDto {
  @IsEmail()
  mailboxEmail: string;

  @IsOptional()
  @IsString()
  senderPattern?: string;

  @IsOptional()
  @IsString()
  subjectPattern?: string;

  @IsIn(['ticket', 'document', 'discard'])
  destination: string;

  @IsOptional()
  @IsUUID()
  targetGroupId?: string | null;

  @IsOptional()
  @IsIn(['auto_match_asset', 'fixed_customer_id'])
  targetCustomerStrategy?: string | null;

  @IsOptional()
  @IsUUID()
  fixedCustomerId?: string | null;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateMailboxRuleDto {
  @IsOptional()
  @IsString()
  senderPattern?: string;

  @IsOptional()
  @IsString()
  subjectPattern?: string;

  @IsOptional()
  @IsIn(['ticket', 'document', 'discard'])
  destination?: string;

  @IsOptional()
  @IsUUID()
  targetGroupId?: string | null;

  @IsOptional()
  @IsIn(['auto_match_asset', 'fixed_customer_id'])
  targetCustomerStrategy?: string | null;

  @IsOptional()
  @IsUUID()
  fixedCustomerId?: string | null;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
