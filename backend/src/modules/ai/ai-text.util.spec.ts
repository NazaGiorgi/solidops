import {
  cleanTicketText,
  cosineSimilarity,
  extractJsonObject,
  firstValues,
  stripThinkTags,
  truncateForContext,
} from './ai-text.util';

describe('AI text helpers', () => {
  it('saca bloques <think> aunque el modelo los devuelva', () => {
    expect(stripThinkTags('<think>no mostrar</think>Respuesta final')).toBe('Respuesta final');
    expect(stripThinkTags('Respuesta final<think>sin cerrar')).toBe('Respuesta final');
  });

  it('limpia firmas y texto citado de un email', () => {
    const body = [
      'La impresora no imprime',
      'Ya reinicié el equipo',
      '--',
      'Firma del cliente',
      '> mensaje original',
    ].join('\n');
    expect(cleanTicketText(body)).toBe('La impresora no imprime\nYa reinicié el equipo');
  });

  it('trunca textos largos sin superar el contexto', () => {
    const text = 'a'.repeat(100000);
    const result = truncateForContext(text, 1000);
    expect(result.length).toBeLessThan(3700);
    expect(result).toContain('texto truncado');
  });

  it('calcula similitud coseno y respeta el orden de los pares', () => {
    const a = [1, 0, 0];
    const parecido = [0.95, 0.1, 0];
    const distinto = [0, 1, 0];
    expect(cosineSimilarity(a, parecido)).toBeGreaterThan(cosineSimilarity(a, distinto));
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
  });

  it('redondea los primeros valores para mostrar', () => {
    expect(firstValues([0.123456789, 0.987654321, 0.5], 2)).toEqual([0.123457, 0.987654]);
  });

  it('extrae JSON de respuestas con texto alrededor', () => {
    const parsed = extractJsonObject('Clasificación:\n```json\n{"categoria":"Redes"}\n```\nEspero que sirva.');
    expect(parsed).toEqual({ categoria: 'Redes' });
    expect(extractJsonObject('sin json')).toBeNull();
  });
});
