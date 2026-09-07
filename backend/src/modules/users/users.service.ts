import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../../entities/user.entity';
import { Role } from '../../entities/role.entity';
import { CreateUserDto, UpdateUserDto } from './dto';
import { AuditAction, AuditEntityType, RoleName } from '../../common/enums';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    private readonly audit: AuditService,
  ) {}

  private listQuery() {
    return this.users
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role')
      .leftJoinAndSelect('user.technician', 'technician');
  }

  async findAll(): Promise<User[]> {
    return this.listQuery().orderBy('user.name', 'ASC').getMany();
  }

  async findOne(id: string): Promise<User> {
    const user = await this.listQuery().where('user.id = :id', { id }).getOne();
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  async create(dto: CreateUserDto, actor: AuthenticatedUser): Promise<User> {
    const role = await this.roles.findOne({ where: { name: dto.role } });
    if (!role) throw new NotFoundException('Rol no encontrado');
    const hash = await bcrypt.hash(dto.password, 10);
    const user = this.users.create({
      name: dto.name,
      email: dto.email,
      passwordHash: hash,
      roleId: role.id,
      active: dto.active ?? true,
    });
    const saved = await this.users.save(user);
    await this.audit.log({
      user: actor,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.USER,
      entityId: saved.id,
      newValue: { name: saved.name, email: saved.email, role: role.name },
    });
    return this.findOne(saved.id);
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthenticatedUser): Promise<User> {
    const user = await this.findOne(id);
    const old = { name: user.name, email: user.email, role: user.role?.name, active: user.active };
    // Máxima protección al alterar el estado activo vía update (PATCH) también.
    if (dto.active === false) await this.assertCanDeactivate(user, actor);
    if (dto.name !== undefined) user.name = dto.name;
    if (dto.email !== undefined) user.email = dto.email;
    if (dto.active !== undefined) user.active = dto.active;
    if (dto.role) {
      const role = await this.roles.findOne({ where: { name: dto.role } });
      if (!role) throw new NotFoundException('Rol no encontrado');
      user.roleId = role.id;
    }
    if (dto.password) {
      user.passwordHash = await bcrypt.hash(dto.password, 10);
    }
    await this.users.save(user);
    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.USER,
      entityId: id,
      oldValue: old,
      newValue: {
        name: user.name,
        email: user.email,
        role: user.role?.name,
        active: user.active,
      },
    });
    return this.findOne(id);
  }

  // --- Protecciones de desactivación ----------------------------------------
  // El estado activo de un usuario NO puede implicar dejar el sistema sin un
  // administrador activo, ni bloquear al usuario que está realizando la acción.
  private async assertCanDeactivate(target: User, actor: AuthenticatedUser): Promise<void> {
    if (target.id === actor.id) throw new ConflictException('No podés desactivar tu propio usuario');
    if (target.role?.name !== RoleName.ADMINISTRADOR) return;
    const activeAdminCount = await this.users
      .createQueryBuilder('user')
      .innerJoin('user.role', 'role')
      .where('role.name = :name', { name: RoleName.ADMINISTRADOR })
      .andWhere('user.active = true')
      .getCount();
    if (activeAdminCount <= 1) {
      throw new ConflictException('No se puede desactivar al último administrador activo del sistema.');
    }
  }

  async deactivate(id: string, actor: AuthenticatedUser): Promise<void> {
    const user = await this.findOne(id);
    await this.assertCanDeactivate(user, actor);
    user.active = false;
    await this.users.save(user);
    await this.audit.log({
      user: actor,
      action: AuditAction.DELETE,
      entityType: AuditEntityType.USER,
      entityId: id,
      oldValue: { active: true },
      newValue: { active: false },
    });
  }
}
