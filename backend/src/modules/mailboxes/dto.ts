import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateMailboxDto {
  @IsEmail()
  email: string;

  @IsString()
  imapHost: string;

  @IsInt()
  @Min(1)
  imapPort: number;

  @IsString()
  imapUser: string;

  // Optional at the DTO level (an admin may not change it on edit). Required
  // for CREATE is enforced in MailboxesService with a clear message.
  @IsOptional()
  @IsString()
  imapPassword?: string;

  @IsBoolean()
  imapSsl: boolean;

  @IsOptional()
  @IsString()
  smtpHost?: string;

  @IsOptional()
  @IsInt()
  smtpPort?: number;

  @IsOptional()
  @IsString()
  smtpUser?: string;

  @IsOptional()
  @IsString()
  smtpPassword?: string;

  @IsOptional()
  @IsBoolean()
  smtpSsl?: boolean;

  @IsOptional()
  @IsIn(['starttls', 'implicit'])
  smtpSecurity?: string;

  @IsOptional()
  @IsBoolean()
  keepOnServer?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  shadowMode?: boolean;

  // Catch-all destination when no rule matches. ''/undefined = legacy 'ticket'.
  @IsOptional()
  @IsIn(['', 'ticket', 'document', 'discard'])
  defaultDestination?: string;
}

export class UpdateMailboxDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  imapHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  imapPort?: number;

  @IsOptional()
  @IsString()
  imapUser?: string;

  // Optional: only set when the user wants to change the password. When
  // omitted, the existing (encrypted) password is preserved.
  @IsOptional()
  @IsString()
  imapPassword?: string;

  @IsOptional()
  @IsBoolean()
  imapSsl?: boolean;

  @IsOptional()
  @IsString()
  smtpHost?: string;

  @IsOptional()
  @IsInt()
  smtpPort?: number;

  @IsOptional()
  @IsString()
  smtpUser?: string;

  @IsOptional()
  @IsString()
  smtpPassword?: string;

  @IsOptional()
  @IsBoolean()
  smtpSsl?: boolean;

  @IsOptional()
  @IsIn(['starttls', 'implicit'])
  smtpSecurity?: string;

  @IsOptional()
  @IsBoolean()
  keepOnServer?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  shadowMode?: boolean;

  @IsOptional()
  @IsIn(['', 'ticket', 'document', 'discard'])
  defaultDestination?: string;
}

// Test-only DTO: check IMAP credentials without saving.
export class TestMailboxDto {
  @IsString()
  imapHost: string;

  @IsInt()
  @Min(1)
  imapPort: number;

  @IsString()
  imapUser: string;

  @IsString()
  imapPassword: string;

  @IsBoolean()
  imapSsl: boolean;
}

// Test-only DTO: verify the SMTP transport (handshake) without sending mail.
export class TestSmtpDto {
  @IsString()
  smtpHost: string;

  @IsInt()
  @Min(1)
  smtpPort: number;

  @IsString()
  smtpUser: string;

  @IsString()
  smtpPassword: string;

  @IsIn(['starttls', 'implicit'])
  smtpSecurity: string;
}
