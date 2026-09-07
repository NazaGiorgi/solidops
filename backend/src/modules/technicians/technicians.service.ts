import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Technician } from '../../entities/technician.entity';
import { User } from '../../entities/user.entity';
import { CreateTechnicianDto, UpdateTechnicianDto, UpdatePresenceDto } from './dto';
import { StorageService } from '../../storage/storage.service';
import { AuditAction, AuditEntityType } from '../../common/enums';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@Injectable()
export class TechniciansService {
  constructor(
    @InjectRepository(Technician) private readonly technicians: Repository<Technician>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private listQuery() {
    return this.technicians
      .createQueryBuilder('technician')
      .leftJoinAndSelect('technician.user', 'user')
      .where('user.active = :active', { active: true });
  }

  async findAll(): Promise<Technician[]> {
    return this.listQuery().orderBy('user.name', 'ASC').getMany();
  }

  async findOne(id: string): Promise<Technician> {
    const tech = await this.technicians.findOne({
      where: { id },
      relations: { user: true },
    });
    if (!tech) throw new NotFoundException('Técnico no encontrado');
    return tech;
  }

  async findByUserId(userId: string): Promise<Technician | null> {
    return this.technicians.findOne({ where: { userId } });
  }

  // Create a technician profile tied to an existing user account.
  async create(dto: CreateTechnicianDto, actor: AuthenticatedUser): Promise<Technician> {
    if (await this.findByUserId(dto.userId)) {
      throw new BadRequestException('Ese usuario ya tiene perfil de técnico');
    }
    const user = await this.users.findOne({ where: { id: dto.userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const tech = this.technicians.create({
      userId: dto.userId,
      specialties: dto.specialties ?? [],
      level: dto.level ?? ('mid' as never),
      schedule: (dto.schedule ?? {}) as Record<string, unknown>,
      status: dto.status ?? ('disponible' as never),
      notes: dto.notes ?? null,
      avatarUrl: dto.avatarUrl ?? null,
      whatsappPhone: dto.whatsappPhone ?? null,
    });
    const saved = await this.technicians.save(tech);
    await this.audit.log({
      user: actor,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.TECHNICIAN,
      entityId: saved.id,
      newValue: { userId: saved.userId, level: saved.level },
    });
    return this.findOne(saved.id);
  }

  async update(
    id: string,
    dto: UpdateTechnicianDto,
    actor: AuthenticatedUser,
  ): Promise<Technician> {
    const tech = await this.findOne(id);
    const old = {
      level: tech.level,
      status: tech.status,
      specialties: tech.specialties,
    };
    Object.assign(tech, dto);
    const saved = await this.technicians.save(tech);
    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.TECHNICIAN,
      entityId: id,
      oldValue: old as unknown as Record<string, unknown>,
      newValue: {
        level: saved.level,
        status: saved.status,
        specialties: saved.specialties,
      },
    });
    return this.findOne(id);
  }

  // Quick presence toggle (available / busy / off-hours).
  async setPresence(
    id: string,
    dto: UpdatePresenceDto,
    actor: AuthenticatedUser,
  ): Promise<Technician> {
    const tech = await this.findOne(id);
    const old = tech.status;
    tech.status = dto.status;
    await this.technicians.save(tech);
    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.TECHNICIAN,
      entityId: id,
      oldValue: { status: old },
      newValue: { status: tech.status },
    });
    return this.findOne(id);
  }

  // Upload avatar to MinIO and attach the resulting URL.
  async uploadAvatar(id: string, file: Express.Multer.File): Promise<Technician> {
    const tech = await this.findOne(id);
    const { url } = await this.storage.putObject(file.buffer, file.originalname, file.mimetype, 'avatars');
    tech.avatarUrl = url;
    await this.technicians.save(tech);
    return this.findOne(id);
  }
}
