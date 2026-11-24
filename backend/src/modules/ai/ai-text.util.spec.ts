import {
  citasTicket,
  cleanTicketText,
  copiaHiloDelTicket,
  cosineSimilarity,
  extractJsonObject,
  maskSecrets,
  nombresPropiosExternos,
  firstValues,
  inventaDatoDelHilo,
  isProbablyEnglish,
  normalizeText,
  parecidoTextos,
  sinDatosSiCorresponde,
  stripThinkTags,
  truncateForContext,
} from './ai-text.util';

describe('AI text helpers', () => {
  it('saca bloques <think> aunque el modelo los devuelva', () => {
    expect(stripThinkTags('<think>no mostrar</think>Respuesta final')).toBe('Respuesta final');
    expect(stripThinkTags('Respuesta final<think>sin cerrar')).toBe('Respuesta final');
  });

  it('saca el razonamiento cuando qwen3 cierra </think> sin abrir', () => {
    expect(stripThinkTags('Okay, déjame pensar...\n</think>\n\nhola')).toBe('hola');
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

  it('detecta respuestas en inglés y respeta el español con acentos', () => {
    expect(isProbablyEnglish('The switch connects devices on the network.')).toBe(true);
    expect(isProbablyEnglish('El switch conecta dispositivos de red.')).toBe(false);
    expect(isProbablyEnglish('La prioridad es crítica.')).toBe(false);
    expect(isProbablyEnglish('hola')).toBe(false);
  });

  it('normaliza opciones para comparar sin importar tildes ni mayúsculas', () => {
    expect(normalizeText('Crítica')).toBe(normalizeText('critica'));
    expect(normalizeText('Red / Conectividad')).toBe('red conectividad');
  });

  it('convierte explicaciones de ausencia de datos a "Sin datos"', () => {
    expect(sinDatosSiCorresponde('No se ha realizado ningún probado')).toBe('Sin datos');
    expect(sinDatosSiCorresponde('No se especifica si se instaló')).toBe('Sin datos');
    expect(sinDatosSiCorresponde('No se proporcionaron acciones previas')).toBe('Sin datos');
    expect(sinDatosSiCorresponde('')).toBe('');
    expect(sinDatosSiCorresponde('No se conecta la impresora')).toBe('No se conecta la impresora');
  });

  it('rechaza borradores que copian marcadores del hilo', () => {
    const hilo = 'CLIENTE: Hola, necesito ayuda con la red.';
    expect(copiaHiloDelTicket('CLIENTE: Hola, necesito ayuda con la red.', hilo)).toBe(true);
    expect(copiaHiloDelTicket('EQUIPO SOLIDO: Ya estamos revisando.', hilo)).toBe(true);
    expect(copiaHiloDelTicket('Contacto: Adriana\n1️⃣ No tengo internet / la red no anda', hilo)).toBe(true);
    expect(copiaHiloDelTicket('Elegí una opción escribiendo el número.', hilo)).toBe(true);
    expect(copiaHiloDelTicket('Registramos tu consulta y te avisamos.', hilo)).toBe(true);
    expect(copiaHiloDelTicket('Estamos fuera de nuestro horario de atención.', hilo)).toBe(true);
    expect(copiaHiloDelTicket('Puede requerir una plantilla aprobada.', hilo)).toBe(true);
    expect(copiaHiloDelTicket('Ya revisamos el equipo y lo dejamos funcionando.', hilo)).toBe(false);
  });

  it('rechaza más de 15 palabras seguidas copiadas del hilo', () => {
    const hilo = Array.from({ length: 20 }, (_, i) => `palabra${i}`).join(' ');
    expect(copiaHiloDelTicket('Texto propio breve.', hilo)).toBe(false);
    expect(copiaHiloDelTicket(hilo, hilo)).toBe(true);
    expect(copiaHiloDelTicket(`Veo que ${hilo} y seguimos`, hilo)).toBe(true);
  });

  it('rechaza plazos y datos internos inventados', () => {
    const hilo = 'El técnico dijo que vuelve mañana a primera hora.';
    expect(inventaDatoDelHilo('Te avisamos en 24 horas.', hilo)).toBe(true);
    expect(inventaDatoDelHilo('Está como prioridad normal en el sistema.', hilo)).toBe(true);
    expect(inventaDatoDelHilo('El estado actual es nuevo.', hilo)).toBe(true);
    expect(inventaDatoDelHilo('La prioridad asignada es normal.', hilo)).toBe(true);
    expect(inventaDatoDelHilo('Le enviamos el TeamViewer.', hilo)).toBe(true);
    expect(inventaDatoDelHilo('Le envié el TeamViewer y ya me conecté.', hilo)).toBe(true);
    expect(inventaDatoDelHilo('El soporte por WhatsApp ha sido activado.', hilo)).toBe(true);
    expect(inventaDatoDelHilo('Por el momento no se ha asignado un técnico.', hilo)).toBe(true);
    expect(inventaDatoDelHilo('El acceso se envió por correo a [cid:part1@ejemplo].', hilo)).toBe(
      true,
    );
    expect(inventaDatoDelHilo('Te avisamos mañana a primera hora.', hilo)).toBe(false);
    expect(inventaDatoDelHilo('El técnico indicó que vuelve en 2 horas.', 'vuelve en 2 horas')).toBe(
      false,
    );
  });

  it('enmascara credenciales sin alterar frases que no tienen valor', () => {
    expect(maskSecrets('La contraseña es: supersecreto123')).toBe('La contraseña: [oculto]');
    expect(maskSecrets('password=abc123 y token=xyz789')).toBe(
      'password: [oculto] y token: [oculto]',
    );
    expect(maskSecrets('La clave del wifi es "clave segura 123"')).toBe('La clave: [oculto]');
    expect(maskSecrets('Contraseña. Si realizó este cambio, no requiere acción.')).toBe(
      'Contraseña. Si realizó este cambio, no requiere acción.',
    );
    expect(maskSecrets('El técnico reinició el router.')).toBe('El técnico reinició el router.');
  });

  it('extrae sólo citas de ticket con formato TKAAAA-NNNNN', () => {
    expect(citasTicket('Hicimos X. (Fuente: TK-2026-40033) y TK-2025-12')).toEqual([
      'TK-2026-40033',
      'TK-2025-12',
    ]);
    expect(citasTicket('Sin fuente')).toEqual([]);
  });

  it('mide parecido por tokens de dominio y descarta antecedentes ajenos', () => {
    expect(
      parecidoTextos(
        'Hola, necesito ayuda con la red. Categoría Red / Conectividad',
        'hola estamos sin internet. Se realizaron pruebas de conectividad y reinicio de router.',
      ),
    ).toBeGreaterThanOrEqual(0.2);
    expect(
      parecidoTextos(
        'Necesito ayuda con una factura',
        'hola estamos sin internet, hay conectividad',
      ),
    ).toBe(0);
  });

  it('detecta nombres propios de otro cliente pero permite los del ticket actual', () => {
    expect(
      nombresPropiosExternos(
        'Contactar a Telered y a Juan Perez en la IP 192.168.1.5. (Fuente: TK-2026-1)',
        'La computadora de Adriana no abre PDF.',
      ),
    ).toEqual(['Telered', 'Juan', 'Perez', '192.168.1.5']);
    expect(
      nombresPropiosExternos(
        'Reiniciar la computadora de Adriana. (Fuente: TK-2026-1)',
        'Contacto real: Adriana Bastida.',
      ),
    ).toEqual([]);
  });
});
