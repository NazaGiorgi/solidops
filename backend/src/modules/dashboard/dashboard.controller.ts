import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { Permissions } from '../../common/guards/permissions-key.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  // "Mi día" — entry screen for technicians/coordinators.
  @Get('my-day')
  @Permissions(PERMISSIONS.CALENDAR_READ, PERMISSIONS.TICKETS_READ)
  myDay(@CurrentUser() user: AuthenticatedUser) {
    return this.service.myDay(user);
  }

  // General dashboard — supervisors.
  @Get('general')
  @Permissions(PERMISSIONS.DASHBOARD_GENERAL)
  general() {
    return this.service.general();
  }
}
