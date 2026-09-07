import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CalendarService } from './calendar.service';
import {
  CreateAppointmentDto,
  UpdateAppointmentDto,
  MoveAppointmentDto,
  CreateTaskDto,
  UpdateTaskDto,
  ListCalendarQuery,
} from './dto';
import { Permissions } from '../../common/guards/permissions-key.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@Controller()
export class CalendarController {
  constructor(private readonly service: CalendarService) {}

  // --- Appointments (polymorphic) ---
  @Get('appointments')
  @Permissions(PERMISSIONS.CALENDAR_READ)
  getAppointments(@Query() query: ListCalendarQuery, @CurrentUser() user: AuthenticatedUser) {
    return this.service.getAppointments(query, user);
  }

  @Get('appointments/:id')
  @Permissions(PERMISSIONS.CALENDAR_READ)
  getAppointment(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.getAppointment(id, user);
  }

  @Post('appointments')
  @Permissions(PERMISSIONS.CALENDAR_WRITE)
  createAppointment(
    @Body() dto: CreateAppointmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createAppointment(dto, user);
  }

  @Patch('appointments/:id')
  @Permissions(PERMISSIONS.CALENDAR_WRITE)
  updateAppointment(
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateAppointment(id, dto, user);
  }

  @Post('appointments/:id/move')
  @Permissions(PERMISSIONS.CALENDAR_WRITE)
  moveAppointment(
    @Param('id') id: string,
    @Body() dto: MoveAppointmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.moveAppointment(id, dto, user);
  }

  @Delete('appointments/:id')
  @Permissions(PERMISSIONS.CALENDAR_WRITE)
  deleteAppointment(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.deleteAppointment(id, user);
  }

  // --- Tasks ---
  @Get('tasks')
  @Permissions(PERMISSIONS.CALENDAR_READ)
  getTasks(@Query() query: ListCalendarQuery, @CurrentUser() user: AuthenticatedUser) {
    return this.service.getTasks(query, user.technicianId ?? undefined);
  }

  @Get('tasks/:id')
  @Permissions(PERMISSIONS.CALENDAR_READ)
  getTask(@Param('id') id: string) {
    return this.service.getTask(id);
  }

  @Post('tasks')
  @Permissions(PERMISSIONS.CALENDAR_WRITE)
  createTask(@Body() dto: CreateTaskDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.createTask(dto, user);
  }

  @Patch('tasks/:id')
  @Permissions(PERMISSIONS.CALENDAR_WRITE)
  updateTask(
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateTask(id, dto, user);
  }
}
