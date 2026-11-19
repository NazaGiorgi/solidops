import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AiService } from './ai.service';
import { AiTicketsService } from './ai-tickets.service';

const user = { id: 'user-1', permissions: ['ai.ticket', 'tickets:read'] } as AuthenticatedUser;

function build(ticketsEnabled: boolean) {
  const ai = {
    summarizeTicket: jest.fn(async () => ({ summary: {} })),
    classifyTicket: jest.fn(async () => ({ ai: {} })),
    replyDraft: jest.fn(async () => ({ draft: 'Hola, ...' })),
    relatedTickets: jest.fn(async () => ({ related: [] })),
  } as unknown as AiService;
  const config = {
    get: jest.fn((key: string) => (key === 'ai.ticketsEnabled' ? ticketsEnabled : undefined)),
  } as unknown as ConfigService;
  return { service: new AiTicketsService(ai, config), ai };
}

describe('AiTicketsService', () => {
  it('con AI_TICKETS_ENABLED=false responde 404 y no llama al modelo', async () => {
    const { service, ai } = build(false);
    await expect(service.summary('t-1', user)).rejects.toBeInstanceOf(NotFoundException);
    expect(ai.summarizeTicket).not.toHaveBeenCalled();
  });

  it('usa los features ticket_* para no duplicar la lógica del laboratorio', async () => {
    const { service, ai } = build(true);
    await service.summary('t-1', user);
    await service.classify('t-1', user);
    await service.reply('t-1', user, { tono: 'corto' });
    await service.related('t-1', user);
    expect(ai.summarizeTicket).toHaveBeenCalledWith('t-1', user, 'ticket_summary');
    expect(ai.classifyTicket).toHaveBeenCalledWith('t-1', user, 'ticket_classify');
    expect(ai.replyDraft).toHaveBeenCalledWith(
      't-1',
      user,
      { tono: 'corto' },
      'ticket_reply',
    );
    expect(ai.relatedTickets).toHaveBeenCalledWith('t-1', user, 'ticket_related');
  });

  it('rechaza un segundo pedido mientras el primero sigue en curso', async () => {
    const { service, ai } = build(true);
    let resolver: (() => void) | null = null;
    (ai.summarizeTicket as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolver = () => resolve({ summary: {} });
        }),
    );
    const primera = service.summary('t-1', user);
    await expect(service.summary('t-1', user)).rejects.toBeInstanceOf(ConflictException);
    resolver!();
    await expect(primera).resolves.toEqual({ summary: {} });
    await expect(service.summary('t-1', user)).resolves.toEqual({ summary: {} });
  });
});
