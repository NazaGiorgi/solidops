'use client';
import { useEffect, useRef, useState } from 'react';
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
  current: { category: string | null; priority: string };
  canApply: boolean;
  shadow: boolean;
  onApplyCategory: (category: string) => Promise<void>;
  onApplyPriority: (priority: string) => Promise<void>;
  onUseDraft: (text: string) => void;
}

const SIN_COINCIDENCIA = 'sin coincidencia';

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
  current,
  canApply,
  shadow,
  onApplyCategory,
  onApplyPriority,
  onUseDraft,
}: Props) {
  const [open, setOpen] = useState(false);
  const [features, setFeatures] = useState<Features | null>(null);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [resumenAt, setResumenAt] = useState('');
  const [clasificacion, setClasificacion] = useState<Clasificacion | null>(null);
  const [borrador, setBorrador] = useState('');
  const [relacionados, setRelacionados] = useState<Relacionado[]>([]);
  const [automatico, setAutomatico] = useState(false);
  const [relacionadosCargados, setRelacionadosCargados] = useState(false);
  const relacionadosIniciados = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [segundos, setSegundos] = useState(0);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [noDisponible, setNoDisponible] = useState(false);

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
      .get<{ automaticNotice: boolean; related: Relacionado[] }>(
        `/ai/tickets/${ticketId}/related`,
      )
      .then((r) => {
        setAutomatico(!!r.automaticNotice);
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
    const r = await ejecutar('reply', () =>
      api.post<{ draft: string }>(`/ai/tickets/${ticketId}/reply-draft`, {
        tono,
        ...(tono !== 'base' && borrador ? { borrador } : {}),
      }),
    );
    if (r) setBorrador(r.draft);
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

  return (
    <>
      <button className="btn btn-sm" type="button" onClick={() => setOpen((v) => !v)}>
        🤖 Asistente IA
      </button>
      {open && (
        <aside
          aria-label="Asistente IA"
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            width: Math.min(460, typeof window === 'undefined' ? 460 : window.innerWidth),
            height: '100vh',
            overflowY: 'auto',
            zIndex: 1000,
            padding: 16,
            background: 'var(--bg, #141414)',
            borderLeft: '1px solid var(--border, #3a3a3a)',
            boxShadow: '-8px 0 24px rgba(0,0,0,.35)',
          }}
        >
          <div className="flex flex-between" style={{ alignItems: 'center' }}>
            <h3 className="card-title" style={{ margin: 0 }}>Asistente IA</h3>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setOpen(false)}>
              ✕ cerrar
            </button>
          </div>
          <div className="muted mt-8" style={{ fontSize: 12 }}>
            La IA sugiere, la persona decide. Nada se guarda ni se envía sin un clic explícito.
          </div>

          {noDisponible && (
            <div className="notice notice-error mt-8">
              <strong>IA no disponible.</strong> El ticket sigue funcionando normalmente.
            </div>
          )}
          {error && <div className="notice notice-error mt-8">{error}</div>}
          {aviso && <div className="notice mt-8">{aviso}</div>}
          {busy && (
            <div className="muted mt-8" style={{ fontSize: 12 }}>
              Pensando… ({segundos} s)
            </div>
          )}
          {automatico && (
            <div className="notice mt-8">Parece un aviso automático. No se ofrece respuesta al cliente.</div>
          )}

          <section style={{ marginTop: 16, borderTop: '1px solid var(--border, #3a3a3a)', paddingTop: 12 }}>
            <div className="flex flex-between" style={{ alignItems: 'center' }}>
              <h4 style={{ margin: 0 }}>Resumen</h4>
              <button className="btn btn-sm" type="button" onClick={resumir} disabled={!!busy}>
                {resumen ? 'Actualizar' : 'Resumir'}
              </button>
            </div>
            {resumen && (
              <>
                <div className="muted mt-8" style={{ fontSize: 11 }}>Generado: {resumenAt}</div>
                <div className="stack mt-8" style={{ fontSize: 13 }}>
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

          <section style={{ marginTop: 16, borderTop: '1px solid var(--border, #3a3a3a)', paddingTop: 12 }}>
            <div className="flex flex-between" style={{ alignItems: 'center' }}>
              <h4 style={{ margin: 0 }}>Clasificación</h4>
              <button className="btn btn-sm" type="button" onClick={clasificar} disabled={!!busy}>
                Sugerir clasificación
              </button>
            </div>
            {filas.length > 0 && (
              <div className="stack mt-8" style={{ fontSize: 12 }}>
                {filas.map((f) => {
                  const distinto = normalizar(f.actual) !== normalizar(f.sugerido);
                  return (
                    <div key={f.label} style={{ borderBottom: '1px solid var(--border, #333)', paddingBottom: 6 }}>
                      <div className="muted">{f.label}</div>
                      <div>actual: {f.actual}</div>
                      <div style={{ color: distinto ? '#f0ad4e' : 'inherit' }}>
                        sugerido: {f.sugerido}
                        {distinto && f.sugerido === SIN_COINCIDENCIA ? ' (sin coincidencia)' : ''}
                      </div>
                      {f.kind && canApply && distinto && f.sugerido !== SIN_COINCIDENCIA && (
                        <button
                          className="btn btn-sm mt-8"
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
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {relacionadosCargados && !automatico && !shadow && (
            <section style={{ marginTop: 16, borderTop: '1px solid var(--border, #3a3a3a)', paddingTop: 12 }}>
              <h4 style={{ margin: 0 }}>Respuesta</h4>
              <button
                className="btn btn-sm mt-8"
                type="button"
                onClick={() => proponerRespuesta()}
                disabled={!!busy}
              >
                Proponer respuesta
              </button>
              {borrador && (
                <>
                  <div
                    className="mt-8"
                    style={{ whiteSpace: 'pre-wrap', fontSize: 13, border: '1px solid var(--border, #3a3a3a)', borderRadius: 8, padding: 8 }}
                  >
                    {borrador}
                  </div>
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
                    <button className="btn btn-sm btn-ghost" type="button" onClick={() => setBorrador('')}>
                      Descartar
                    </button>
                  </div>
                  <div className="muted mt-8" style={{ fontSize: 11 }}>
                    Copia el texto a la caja del ticket. No envía nada: revisá y tocá «responder» vos.
                  </div>
                </>
              )}
            </section>
          )}

          <section style={{ marginTop: 16, borderTop: '1px solid var(--border, #3a3a3a)', paddingTop: 12 }}>
            <h4 style={{ margin: 0 }}>Posibles relacionados</h4>
            {relacionados.length === 0 ? (
              <div className="muted mt-8" style={{ fontSize: 12 }}>Sin coincidencias en los últimos 90 días.</div>
            ) : (
              <ul className="stack mt-8" style={{ fontSize: 12, paddingLeft: 16 }}>
                {relacionados.map((r) => (
                  <li key={r.id}>
                    <Link href={`/tickets/${r.id}`} className="link">
                      {r.numero || `#${r.id.slice(0, 8)}`} · {r.titulo}
                    </Link>
                    <div className="muted">
                      {new Date(r.fecha).toLocaleDateString('es-AR')} · {r.estado}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      )}
    </>
  );
}
