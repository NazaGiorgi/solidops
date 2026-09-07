import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../../entities/notification.entity';
import { NotificationType } from '../../common/enums';
import { NotificationsGateway } from './notifications.gateway';

// Creates in-app notifications and pushes them live over Socket.IO.
@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    private readonly gateway: NotificationsGateway,
  ) {}

  async create(params: {
    userId: string;
    type: NotificationType;
    payload: Record<string, unknown>;
  }) {
    const n = this.notifications.create(params);
    const saved = await this.notifications.save(n);
    // Push live to the target user's socket (if connected).
    this.gateway.emitToUser(saved.userId, 'notification:new', saved);
    return saved;
  }

  async listForUser(userId: string, unreadOnly = false) {
    const qb = this.notifications
      .createQueryBuilder('n')
      .where('n.user_id = :userId', { userId })
      .orderBy('n.created_at', 'DESC')
      .take(60);
    if (unreadOnly) qb.andWhere('n.read_at IS NULL');
    return qb.getMany();
  }

  async unreadCount(userId: string) {
    return this.notifications
      .createQueryBuilder('n')
      .where('n.user_id = :userId', { userId })
      .andWhere('n.read_at IS NULL')
      .getCount();
  }

  async markRead(userId: string, id: string) {
    const n = await this.notifications.findOne({ where: { id, userId } });
    if (!n) return null;
    n.readAt = new Date();
    return this.notifications.save(n);
  }

  async markAllRead(userId: string) {
    return this.notifications
      .createQueryBuilder()
      .update()
      .set({ readAt: new Date() })
      .where('user_id = :userId', { userId })
      .andWhere('read_at IS NULL')
      .execute();
  }
}
