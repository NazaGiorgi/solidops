import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { RoleName } from '../../common/enums';

export class CreateUserDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsEnum(RoleName)
  role: RoleName;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(RoleName)
  role?: RoleName;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  // Optional reset password (only when set).
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

export class CreateTechnicianFromUserDto {
  @IsUUID()
  userId: string;
}

export class ParamIdDto {
  @IsUUID()
  id: string;
}
