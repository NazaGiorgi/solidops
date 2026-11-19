import { IsIn, IsOptional, IsString } from 'class-validator';

export class ReplyDraftDto {
  @IsOptional()
  @IsIn(['base', 'corto', 'formal'])
  tono?: 'base' | 'corto' | 'formal';

  @IsOptional()
  @IsString()
  borrador?: string;
}
