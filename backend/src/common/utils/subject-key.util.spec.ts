import { normalizeSubjectKey } from './subject-key.util';

describe('normalizeSubjectKey', () => {
  it('lowercases and trims', () => {
    expect(normalizeSubjectKey('  Mi Impresora No Anda ')).toBe('mi impresora no anda');
  });
  it('strips reply / forward prefixes', () => {
    expect(normalizeSubjectKey('Re: Impresora no anda')).toBe('impresora no anda');
    expect(normalizeSubjectKey('FWD: [Ticket] Servidor caído')).toBe('servidor caído');
    expect(normalizeSubjectKey('fw: Rápido')).toBe('rápido');
  });
  it('removes ticket tags and brackets', () => {
    expect(normalizeSubjectKey('[#123] Otro asunto')).toBe('otro asunto');
    expect(normalizeSubjectKey('Un caso #456 con #tags')).toBe('un caso con tags');
  });
});
