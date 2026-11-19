import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Permissions } from '../../common/guards/permissions-key.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
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
// no existen (404); /features queda disponible para todos los roles con
// `tickets:read` para que el panel del ticket sepa si debe mostrarse.
// El @Roles va por método (no a nivel de clase) para no heredar el bloqueo al
// endpoint de features: RolesGuard exige permiso Y rol cuando ambos existen.
@Controller('ai')
@UseGuards(RolesGuard)
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

  // Metadata a nivel de método: el front necesita saber si el panel existe
  // aunque el usuario no sea administrador (Laboratorio sigue siendo Admin).
  @Permissions(PERMISSIONS.TICKETS_READ)
  @Get('features')
  features() {
    return this.ai.features();
  }

  @Roles(RoleName.ADMINISTRADOR)
  @Get('health')
  health() {
    this.ensureLab();
    return this.ai.health();
  }

  @Roles(RoleName.ADMINISTRADOR)
  @Post('lab/chat')
  chat(@Body() dto: ChatDto, @CurrentUser() user: AuthenticatedUser) {
    this.ensureLab();
    return this.ai.chat(dto.prompt, user, { model: dto.model });
  }

  @Roles(RoleName.ADMINISTRADOR)
  @Post('lab/embed')
  embed(@Body() dto: EmbedDto, @CurrentUser() user: AuthenticatedUser) {
    this.ensureLab();
    return this.ai.embed(dto.text, user);
  }

  @Roles(RoleName.ADMINISTRADOR)
  @Post('lab/similarity')
  similarity(@Body() dto: SimilarityDto, @CurrentUser() user: AuthenticatedUser) {
    this.ensureLab();
    return this.ai.similarity(dto.a, dto.b, user);
  }

  @Roles(RoleName.ADMINISTRADOR)
  @Post('lab/ticket/:id/summarize')
  summarize(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    this.ensureLab();
    return this.ai.summarizeTicket(id, user);
  }

  @Roles(RoleName.ADMINISTRADOR)
  @Post('lab/ticket/:id/classify')
  classify(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    this.ensureLab();
    return this.ai.classifyTicket(id, user);
  }

  @Roles(RoleName.ADMINISTRADOR)
  @Post('lab/benchmark')
  benchmark(@CurrentUser() user: AuthenticatedUser) {
    this.ensureLab();
    return this.ai.benchmark(user);
  }
}
