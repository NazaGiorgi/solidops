export function publicTicketNumber(
  ticketNumber: number | null | undefined,
  createdAt?: Date | string | null,
): string {
  if (!ticketNumber) return '';
  const year = createdAt ? new Date(createdAt).getFullYear() : new Date().getFullYear();
  return `TK-${year}-${ticketNumber}`;
}