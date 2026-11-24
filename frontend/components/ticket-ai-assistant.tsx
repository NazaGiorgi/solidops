'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { api, ApiError } from '../lib/api';
import { PRIORITY_LABELS } from '../lib/helpers';

interface Features {
  aiEnabled: boolean;
  aiTicketsEnabled: boolean;
}

interface Resumen {
  pedido: string;
  probado: string;
  falta: string;
  cliente: string;
}

interface Clasificacion {
  ai: {
    categoria: string;
    prioridad: string;
    especialidad: string;
    duracionEstimada: number | string;
    animo: string;
  };
}

interface Relacionado {
  id: string;
  numero: string;
  titulo: string;
  estado: string;
  fecha: string;
}

interface Props {
  ticketId: string;
  status: string;
  current: { category: string | null; priority: string };
  canApply: boolean;
  shadow: boolean;
  onApplyCategory: (category: string) => Promise<void>;
  onApplyPriority: (priority: string) => Promise<void>;
  onUseDraft: (text: string) => void;
}

const SIN_COINCIDENCIA = 'sin coincidencia';
const OPEN_KEY = 'solidops-ai-assistant-open';

function mensajeDe(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return (e as Error)?.message || 'No se pudo completar la operación';
}

function normalizar(v: string | null | undefined): string {
  return (v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function valorPrioridad(v: string): string | null {
  const n = normalizar(v);
  return ['baja', 'normal', 'alta', 'critica'].includes(n) ? n : null;
}

function etiquetaPrioridad(v: string): string {
  return PRIORITY_LABELS[valorPrioridad(v) || ''] || v;
}

export function TicketAiAssistant({
  ticketId,
  status,
  current,
  canApply,
  shadow,
  onApplyCategory,
  onApplyPriority,
  onUseDraft,
}: Props) {
  const [open, setOpen] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [features, setFeatures] = useState<Features | null>(null);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [resumenAt, setResumenAt] = useState('');
  const [clasificacion, setClasificacion] = useState<Clasificacion | null>(null);
  const [borrador, setBorrador] = useState('');
  const [borradorError, setBorradorError] = useState('');
  const [relacionados, setRelacionados] = useState<Relacionado[]>([]);
  const [consultaRelacionados, setConsultaRelacionados] = useState('');
  const [automatico, setAutomatico] = useState(false);
  const [relacionadosCargados, setRelacionadosCargados] = useState(false);
  const relacionadosIniciados = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [segundos, setSegundos] = useState(0);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [noDisponible, setNoDisponible] = useState(false);

  // Recordar abierto/cerrado por usuario. localStorage puede estar bloqueado:
  // el panel sigue funcionando aunque no se pueda persistir la preferencia.
  function cambiarOpen(valor: boolean) {
    setOpen(valor);
    try {
      localStorage.setItem(OPEN_KEY, String(valor));
    } catch {
      // Sin persistencia: sólo se pierde la preferencia entre recargas.
    }
  }

  useEffect(() => {
    try {
      const guardado = localStorage.getItem(OPEN_KEY);
      if (guardado !== null) setOpen(guardado === 'true');
    } catch {
      // Sin persistencia: arranca cerrado.
    }
    // El panel se monta en la columna lateral de la pantalla del ticket.
    setPortalTarget(document.getElementById('ticket-ai-panel-slot'));
  }, []);

  useEffect(() => {
    api
      .get<Features>('/ai/features')
      .then((f) =>
        setFeatures({
          aiEnabled: !!f?.aiEnabled,
          aiTicketsEnabled: !!f?.aiTicketsEnabled,
        }),
      )
      // Fail-closed: si no sabemos si está habilitado, no mostramos el panel.
      .catch(() => setFeatures({ aiEnabled: false, aiTicketsEnabled: false }));
  }, []);

  useEffect(() => {
    if (!busy) {
      setSegundos(0);
      return;
    }
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  function fallo(e: unknown) {
    if ((e as ApiError)?.status === 503) setNoDisponible(true);
    setError(mensajeDe(e));
  }

  async function ejecutar<T>(clave: string, tarea: () => Promise<T>): Promise<T | null> {
    if (busy) return null;
    setBusy(clave);
    setError('');
    setAviso('');
    try {
      return await tarea();
    } catch (e) {
      fallo(e);
      return null;
    } finally {
      setBusy(null);
    }
  }

  // "Posibles relacionados" se consulta al abrir el panel. El guard con ref
  // evita el doble disparo de React StrictMode en desarrollo.
  useEffect(() => {
    if (!open || !features?.aiTicketsEnabled || relacionadosIniciados.current) return;
    relacionadosIniciados.current = true;
    setBusy('related');
    setError('');
    api
      .get<{ automaticNotice: boolean; consulta?: string; related: Relacionado[] }>(
        `/ai/tickets/${ticketId}/related`,
      )
      .then((r) => {
        setAutomatico(!!r.automaticNotice);
        setConsultaRelacionados(r.consulta || '');
        setRelacionados(r.related || []);
      })
      .catch(fallo)
      .finally(() => {
        // Aunque falle la búsqueda de relacionados, el resto del panel sigue
        // disponible: cada acción tiene su propio estado y error.
        setRelacionadosCargados(true);
        setBusy(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, features, ticketId]);

  async function resumir() {
    const r = await ejecutar('summary', () =>
      api.post<{ summary: Resumen }>(`/ai/tickets/${ticketId}/summary`),
    );
    if (!r) return;
    setResumen(r.summary);
    setResumenAt(new Date().toLocaleString('es-AR'));
  }

  async function clasificar() {
    const r = await ejecutar('classify', () =>
      api.post<Clasificacion>(`/ai/tickets/${ticketId}/classify`),
    );
    if (r) setClasificacion(r);
  }

  async function proponerRespuesta(tono: 'base' | 'corto' | 'formal' = 'base') {
    if (busy) return;
    setBusy('reply');
    setBorradorError('');
    setError('');
    setAviso('');
    try {
      const r = await api.post<{ draft: string }>(`/ai/tickets/${ticketId}/reply-draft`, {
        tono,
        ...(tono !== 'base' && borrador ? { borrador } : {}),
      });
      setBorrador(r.draft);
    } catch (e) {
      const msg = mensajeDe(e);
      if (msg.includes('No se pudo generar un borrador útil')) setBorradorError(msg);
      else fallo(e);
    } finally {
      setBusy(null);
    }
  }

  async function aplicar(kind: 'category' | 'priority', valor: string) {
    await ejecutar(`apply-${kind}`, async () => {
      if (kind === 'category') await onApplyCategory(valor);
      else await onApplyPriority(valor);
      setAviso(kind === 'category' ? 'Categoría aplicada' : 'Prioridad aplicada');
    });
  }

  const visible = !!features?.aiEnabled && !!features?.aiTicketsEnabled;
  if (!visible) return null;

  const cerrado = status === 'cerrado';
  const ai = clasificacion?.ai;
  const filas = ai
    ? [
        { label: 'Categoría', actual: current.category || '—', sugerido: ai.categoria, kind: 'category' as const },
        {
          label: 'Prioridad',
          actual: etiquetaPrioridad(current.priority),
          sugerido: etiquetaPrioridad(ai.prioridad),
          kind: 'priority' as const,
        },
        { label: 'Especialidad', actual: '—', sugerido: ai.especialidad, kind: null },
        { label: 'Duración estimada', actual: '—', sugerido: `${ai.duracionEstimada} min`, kind: null },
        { label: 'Ánimo', actual: '—', sugerido: ai.animo, kind: null },
      ]
    : [];

  const panel = (
    <aside className="ticket-ai-panel" aria-label="Asistente IA">
      <div className="flex flex-between" style={{ alignItems: 'center' }}>
        <h3 className="card-title" style={{ margin: 0 }}>Asistente IA</h3>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => cambiarOpen(false)}>
          ✕ cerrar
        </button>
      </div>
      <div className="ai-muted mt-8">
        La IA sugiere, la persona decide. Nada se guarda ni se envía sin un clic explícito.
      </div>

      {noDisponible && (
        <div className="notice notice-error mt-8">
          <strong>IA no disponible.</strong> El ticket sigue funcionando normalmente.
        </div>
      )}
      {error && <div className="notice notice-error mt-8">{error}</div>}
      {aviso && <div className="notice mt-8">{aviso}</div>}
      {busy && <div className="ai-muted mt-8">Pensando… ({segundos} s)</div>}

      <section className="ai-section">
        <div className="flex flex-between" style={{ alignItems: 'center' }}>
          <h4 style={{ margin: 0 }}>Resumen</h4>
          <button className="btn btn-sm" type="button" onClick={resumir} disabled={!!busy}>
            {resumen ? 'Actualizar' : 'Resumir'}
          </button>
        </div>
        {resumen && (
          <>
            <div className="ai-muted mt-8">Generado: {resumenAt}</div>
            <div className="stack mt-8 ai-small">
              {(['pedido', 'probado', 'falta', 'cliente'] as const).map((k) => (
                <div key={k}>
                  <strong>{k === 'pedido' ? 'Pedido' : k === 'probado' ? 'Probado' : k === 'falta' ? 'Falta' : 'Cliente'}:</strong>{' '}
                  {resumen[k] || 'Sin datos'}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="ai-section">
        <div className="flex flex-between" style={{ alignItems: 'center' }}>
          <h4 style={{ margin: 0 }}>Clasificación</h4>
          <button className="btn btn-sm" type="button" onClick={clasificar} disabled={!!busy}>
            Sugerir clasificación
          </button>
        </div>
        {filas.length > 0 && (
          <table className="ai-compare-table mt-8">
            <thead>
              <tr>
                <th>Campo</th>
                <th>Actual</th>
                <th>Sugerido</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const distinto = normalizar(f.actual) !== normalizar(f.sugerido);
                // Sólo categoría y prioridad se resaltan: el resto es informativo.
                const resaltar = !!f.kind && distinto;
                return (
                  <tr key={f.label}>
                    <td className="muted">{f.label}</td>
                    <td>{f.actual}</td>
                    <td>
                      <span className={resaltar ? 'ai-diff' : ''}>
                        {f.sugerido}
                        {resaltar && f.sugerido === SIN_COINCIDENCIA ? ' (sin coincidencia)' : ''}
                      </span>
                      {f.kind && !shadow && canApply && resaltar && f.sugerido !== SIN_COINCIDENCIA && (
                        <div className="mt-8">
                          <button
                            className="btn btn-sm"
                            type="button"
                            disabled={!!busy}
                            onClick={() =>
                              aplicar(
                                f.kind!,
                                f.kind === 'priority'
                                  ? valorPrioridad(f.sugerido) || f.sugerido
                                  : f.sugerido,
                              )
                            }
                          >
                            Aplicar {f.kind === 'category' ? 'categoría' : 'prioridad'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* El bloque de Respuesta nunca se oculta: si no se puede proponer,
          se explica el motivo. Así no parece que el botón "desapareció". */}
      <section className="ai-section">
        <h4 style={{ margin: 0 }}>Respuesta</h4>
        {!relacionadosCargados ? (
          <button className="btn btn-sm mt-8" type="button" disabled>
            Cargando…
          </button>
        ) : shadow ? (
          <div className="notice notice-shadow mt-8">
            Este ticket viene de una casilla en modo sombra (sólo lectura): no se proponen respuestas.
          </div>
        ) : automatico ? (
          <div className="notice notice-shadow mt-8">
            Este ticket parece un aviso automático: no se propone respuesta al cliente.
          </div>
        ) : (
          <>
            {cerrado && <div className="notice notice-shadow mt-8">Este ticket está cerrado</div>}
            {borradorError && <div className="notice notice-error mt-8">{borradorError}</div>}
            <button
              className="btn btn-sm mt-8"
              type="button"
              onClick={() => proponerRespuesta()}
              disabled={!!busy}
            >
              {borrador ? 'Actualizar borrador' : cerrado ? 'Proponer igual' : 'Proponer respuesta'}
            </button>
            {borrador && (
              <>
                <div className="ai-draft mt-8">{borrador}</div>
                <div className="flex wrap mt-8" style={{ gap: 6 }}>
                  <button
                    className="btn btn-sm btn-primary"
                    type="button"
                    disabled={!!busy}
                    onClick={() => onUseDraft(borrador)}
                  >
                    Usar en la respuesta
                  </button>
                  <button className="btn btn-sm" type="button" disabled={!!busy} onClick={() => proponerRespuesta('corto')}>
                    Más corto
                  </button>
                  <button className="btn btn-sm" type="button" disabled={!!busy} onClick={() => proponerRespuesta('formal')}>
                    Más formal
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    type="button"
                    onClick={() => {
                      setBorrador('');
                      setBorradorError('');
                    }}
                  >
                    Descartar
                  </button>
                </div>
                <div className="ai-muted mt-8">
                  Copia el texto a la caja del ticket. No envía nada: revisá y tocá «responder» vos.
                </div>
              </>
            )}
          </>
        )}
      </section>

      <section className="ai-section">
        <h4 style={{ margin: 0 }}>Posibles relacionados</h4>
        {consultaRelacionados && (
          <div className="ai-consulta mt-8" title={consultaRelacionados}>
            Consulta usada: {consultaRelacionados}
          </div>
        )}
        {relacionados.length === 0 ? (
          <div className="ai-muted mt-8">Sin coincidencias en los últimos 90 días.</div>
        ) : (
          <ul className="stack mt-8 ai-small" style={{ paddingLeft: 16 }}>
            {relacionados.map((r) => (
              <li key={r.id}>
                <Link href={`/tickets/${r.id}`} className="link">
                  {r.numero || `#${r.id.slice(0, 8)}`} · {r.titulo}
                </Link>
                <div className="ai-muted">
                  {new Date(r.fecha).toLocaleDateString('es-AR')} · {r.estado}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );

  return (
    <>
      <button className="btn btn-sm" type="button" onClick={() => cambiarOpen(!open)}>
        🤖 Asistente IA
      </button>
      {open && portalTarget ? createPortal(panel, portalTarget) : null}
    </>
  );
}
