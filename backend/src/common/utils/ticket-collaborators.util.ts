export interface CollaboratorRef {
  id: string;
  name?: string;
}

// Diferencia entre dos conjuntos de colaboradores, por id.
export function collaboratorDiff(
  before: CollaboratorRef[],
  after: CollaboratorRef[],
): { added: string[]; removed: string[] } {
  const beforeIds = new Set(before.map((c) => c.id));
  const afterIds = new Set(after.map((c) => c.id));
  return {
    added: after.filter((c) => !beforeIds.has(c.id)).map((c) => c.id),
    removed: before.filter((c) => !afterIds.has(c.id)).map((c) => c.id),
  };
}

// Texto de la notificación interna al sumar un colaborador.
export function collaboratorNoticeMessage(ticketNumber: string, title: string): string {
  return `Te sumaron como colaborador en ${ticketNumber} — ${title}`;
}

// Valor legible para la auditoría (antes/después con nombres).
export function collaboratorAuditValue(list: CollaboratorRef[]): string[] {
  return list.map((c) => c.name || c.id);
}
