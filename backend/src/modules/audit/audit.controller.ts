import { Controller, Get, Param, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../../entities/audit-log.entity';
import { Permissions } from '../../common/guards/permissions-key.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';

@Controller('audit')
export class AuditController {
  constructor(
    @InjectRepository(AuditLog) private readonly auditRepo: Repository<AuditLog>,
  ) {}

  @Get()
  @Permissions(PERMISSIONS.AUDIT_READ)
  findAll(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('userId') userId?: string,
    @Query('limit') limit?: string,
  ) {
    const qb = this.auditRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.user', 'user')
      .orderBy('a.createdAt', 'DESC')
      .take(parseInt(limit || '100', 10));
    if (entityType) qb.andWhere('a.entity_type = :et', { et: entityType });
    if (entityId) qb.andWhere('a.entity_id = :ei', { ei: entityId });
    if (userId) qb.andWhere('a.user_id = :uid', { uid: userId });
    return qb.getMany();
  }

  @Get(':id')
  @Permissions(PERMISSIONS.AUDIT_READ)
  findOne(@Param('id') id: string) {
    return this.auditRepo.findOne({ where: { id }, relations: { user: true } });
  }
}
