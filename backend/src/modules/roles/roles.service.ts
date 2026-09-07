import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../../entities/role.entity';
import { ALL_PERMISSIONS } from '../../common/auth/permissions';
import { RoleName } from '../../common/enums';

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role) private readonly roles: Repository<Role>,
  ) {}

  async findAll(): Promise<Role[]> {
    return this.roles.find({ order: { name: 'ASC' } });
  }

  // Returns the permission catalog from the DATABASE (single source of truth),
  // not the hardcoded map. `permissions.all` is the set of assignable codes.
  // The API only lists real permission codes in use by controllers.
  permissionCatalog() {
    // Build a "matrix" of role -> permission codes, but computed from DB rows.
    // We can't know all roles statically without DB, so return DB roles.
    return {
      permissions: { all: ALL_PERMISSIONS },
    };
  }

  // Deprecated static helper kept for callers that need a quick role->perms map.
  async findAllWithPermissions(): Promise<Record<string, string[]>> {
    const roles = await this.roles.find();
    return roles.reduce<Record<string, string[]>>((acc, r) => {
      acc[r.name] = r.permissions;
      return acc;
    }, {});
  }

  async findByNames(dto: { roles: RoleName[] }): Promise<Role[]> {
    return this.roles.find({ where: dto.roles.map((name) => ({ name })) });
  }
}
