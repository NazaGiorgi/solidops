import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto, ParamIdDto } from './dto';
import { Permissions } from '../../common/guards/permissions-key.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@Controller('users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  @Permissions(PERMISSIONS.USERS_READ)
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @Permissions(PERMISSIONS.USERS_READ)
  findOne(@Param() params: ParamIdDto) {
    return this.service.findOne(params.id);
  }

  @Post()
  @Permissions(PERMISSIONS.USERS_CREATE)
  create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.USERS_UPDATE)
  update(
    @Param() params: ParamIdDto,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(params.id, dto, user);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.USERS_DELETE)
  deactivate(@Param() params: ParamIdDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.deactivate(params.id, user);
  }
}
