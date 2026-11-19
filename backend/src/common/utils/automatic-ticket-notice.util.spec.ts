import {
  AUTOMATIC_SUBJECT_PATTERN,
  excludeAutomaticNotices,
  isAutomaticNotice,
  personTicketCondition,
} from './automatic-ticket-notice.util';

describe('criterio de avisos automáticos', () => {
  it('considera persona los tickets de WhatsApp, manuales y del portal', () => {
    for (const source of ['whatsapp', 'manual', 'portal']) {
      expect(isAutomaticNotice({ source })).toBe(false);
    }
  });

  it('considera persona un email con mensaje de cliente y asunto normal', () => {
    expect(
      isAutomaticNotice({
        source: 'email',
        subjectKey: 'no puedo conectar la impresora',
        hasClientMessage: true,
      }),
    ).toBe(false);
  });

  it('considera automático un email con patrón de backup en el asunto', () => {
    expect(
      isAutomaticNotice({
        source: 'email',
        subjectKey: 'backup clientes correcto:',
        hasClientMessage: true,
      }),
    ).toBe(true);
  });

  it('considera automático un email sin mensaje de cliente', () => {
    expect(
      isAutomaticNotice({ source: 'email', subjectKey: 'consulta general', hasClientMessage: false }),
    ).toBe(true);
  });

  it('expone el mismo patrón para la consulta SQL', () => {
    const { sql, params } = personTicketCondition('t', 'relAuto');
    expect(sql).toContain("t.source IN (:...relAutoSources)");
    expect(sql).toContain("t.subject_key !~* :relAutoPattern");
    expect(params.relAutoPattern).toBe(AUTOMATIC_SUBJECT_PATTERN);
    expect(params.relAutoSources).toEqual(['whatsapp', 'manual', 'portal']);
  });

  it('excludeAutomaticNotices conserva la condición de persona (no la niega)', () => {
    const andWhere = jest.fn();
    const qb = { andWhere } as never;
    expect(excludeAutomaticNotices(qb, 't', 'relAuto')).toBe(qb);
    const [sql] = andWhere.mock.calls[0];
    expect(sql).toContain('t.source IN (:...relAutoSources)');
    expect(sql).not.toContain('NOT (');
  });
});
