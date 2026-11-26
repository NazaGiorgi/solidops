import {
  collaboratorDiff,
  collaboratorNoticeMessage,
  collaboratorAuditValue,
} from './ticket-collaborators.util';

describe('utilidades de colaboradores de ticket', () => {
  it('detecta sólo los técnicos recién sumados y los quitados', () => {
    const before = [
      { id: 'ana', name: 'Ana' },
      { id: 'pedro', name: 'Pedro' },
    ];
    const after = [
      { id: 'pedro', name: 'Pedro' },
      { id: 'luis', name: 'Luis' },
      { id: 'carmen', name: 'Carmen' },
    ];
    expect(collaboratorDiff(before, after)).toEqual({
      added: ['luis', 'carmen'],
      removed: ['ana'],
    });
  });

  it('no avisa a nadie cuando el conjunto no cambia (aunque cambie el orden)', () => {
    const list = [
      { id: 'a', name: 'Ana' },
      { id: 'b', name: 'Beto' },
    ];
    expect(collaboratorDiff(list, [...list].reverse())).toEqual({ added: [], removed: [] });
  });

  it('arma el mensaje exacto de la notificación interna', () => {
    expect(collaboratorNoticeMessage('TK-2026-40583', 'Impresora offline')).toBe(
      'Te sumaron como colaborador en TK-2026-40583 — Impresora offline',
    );
  });

  it('serializa nombres para la auditoría, con fallback al id', () => {
    expect(collaboratorAuditValue([{ id: 'x', name: 'Pedro' }, { id: 'y' }])).toEqual([
      'Pedro',
      'y',
    ]);
  });
});
