import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AiService } from './ai.service';

// Orquestación del panel de IA dentro del ticket. Toda la generación está en
// AiService (la MISMA que usa el Laboratorio): acá sólo se aplican el flag, el
// feature de métricas y el límite de un pedido en curso por usuario+ticket.
@Injectable()
export class AiTicketsService {
  private readonly enCurso = new Map<string, Promise<unknown>>();

  constructor(
    private readonly ai: AiService,
    private readonly config: ConfigService,
  ) {}

  ensureTicketsEnabled(): void {
    if (!this.config.get<boolean>('ai.ticketsEnabled')) {
      throw new NotFoundException('Asistente IA para tickets no disponible');
    }
  }

  private soloUno<T>(user: AuthenticatedUser, ticketId: string, tarea: () => Promise<T>): Promise<T> {
    const clave = `${user.id}:${ticketId}`;
    if (this.enCurso.has(clave)) {
      throw new ConflictException('Ya hay un pedido de IA en curso para este ticket');
    }
    const promesa = (async () => tarea())().finally(() => {
      this.enCurso.delete(clave);
    });
    this.enCurso.set(clave, promesa);
    return promesa;
  }

  async summary(id: string, user: AuthenticatedUser) {
    this.ensureTicketsEnabled();
    return this.soloUno(user, id, () => this.ai.summarizeTicket(id, user, 'ticket_summary'));
  }

  async classify(id: string, user: AuthenticatedUser) {
    this.ensureTicketsEnabled();
    return this.soloUno(user, id, () => this.ai.classifyTicket(id, user, 'ticket_classify'));
  }

  async reply(
    id: string,
    user: AuthenticatedUser,
    opciones: { tono?: 'base' | 'corto' | 'formal'; borrador?: string } = {},
  ) {
    this.ensureTicketsEnabled();
    return this.soloUno(user, id, () => this.ai.replyDraft(id, user, opciones, 'ticket_reply'));
  }

  async related(id: string, user: AuthenticatedUser) {
    this.ensureTicketsEnabled();
    return this.soloUno(user, id, () => this.ai.relatedTickets(id, user, 'ticket_related'));
  }
}
