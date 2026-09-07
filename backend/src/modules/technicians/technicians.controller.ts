import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TechniciansService } from './technicians.service';
import { CreateTechnicianDto, UpdateTechnicianDto, UpdatePresenceDto } from './dto';
import { Permissions } from '../../common/guards/permissions-key.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@Controller('technicians')
export class TechniciansController {
  constructor(private readonly service: TechniciansService) {}

  @Get()
  @Permissions(PERMISSIONS.TECHNICIANS_READ)
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @Permissions(PERMISSIONS.TECHNICIANS_READ)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Permissions(PERMISSIONS.TECHNICIANS_UPDATE)
  create(@Body() dto: CreateTechnicianDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.TECHNICIANS_UPDATE)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTechnicianDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/presence')
  @Permissions(PERMISSIONS.TECHNICIANS_UPDATE)
  setPresence(
    @Param('id') id: string,
    @Body() dto: UpdatePresenceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setPresence(id, dto, user);
  }

  @Post(':id/avatar')
  @Permissions(PERMISSIONS.TECHNICIANS_UPDATE)
  @UseInterceptors(FileInterceptor('file'))
  uploadAvatar(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    return this.service.uploadAvatar(id, file);
  }
}
