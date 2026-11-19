import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RoleName } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AiService } from './ai.service';

class ChatDto {
  @IsString()
  @IsNotEmpty()
  prompt: string;

  @IsOptional()
  @IsString()
  model?: string;
}

class EmbedDto {
  @IsString()
  @IsNotEmpty()
  text: string;
}

class SimilarityDto {
  @IsString()
  @IsNotEmpty()
  a: string;

  @IsString()
  @IsNotEmpty()
  b: string;
}

// Diagnóstico: sólo Administrador. Sin AI_LAB_ENABLED las rutas del laboratorio
// no existen (404); /features queda disponible para que el front oculte el menú.
@Controller('ai')
@UseGuards(RolesGuard)
@Roles(RoleName.ADMINISTRADOR)
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly config: ConfigService,
  ) {}

  private ensureLab(): void {
    if (!this.config.get<boolean>('ai.labEnabled')) {
      throw new NotFoundException('Laboratorio de IA no disponible');
    }
  }

  @Get('features')
  features() {
    return this.ai.features();
  }

  @Get('health')
  health() {
    this.ensureLab();
    return this.ai.health();
  }

  @Post('lab/chat')
  chat(@Body() dto: ChatDto, @CurrentUser() user: AuthenticatedUser) {
    this.ensureLab();
    return this.ai.chat(dto.prompt, user, { model: dto.model });
  }

  @Post('lab/embed')
  embed(@Body() dto: EmbedDto, @CurrentUser() user: AuthenticatedUser) {
    this.ensureLab();
    return this.ai.embed(dto.text, user);
  }

  @Post('lab/similarity')
  similarity(@Body() dto: SimilarityDto, @CurrentUser() user: AuthenticatedUser) {
    this.ensureLab();
    return this.ai.similarity(dto.a, dto.b, user);
  }

  @Post('lab/ticket/:id/summarize')
  summarize(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    this.ensureLab();
    return this.ai.summarizeTicket(id, user);
  }

  @Post('lab/ticket/:id/classify')
  classify(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    this.ensureLab();
    return this.ai.classifyTicket(id, user);
  }

  @Post('lab/benchmark')
  benchmark(@CurrentUser() user: AuthenticatedUser) {
    this.ensureLab();
    return this.ai.benchmark(user);
  }
}
