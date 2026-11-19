'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { useToast } from '../../../../components/toast';
import { ticketNumberDisplay } from '../../../../lib/helpers';
import { Shell } from '../../shell';
import { Card, Empty, PageHeader, Pill } from '../../../../components/ui';
import { ErrorNotice } from '../../../../components/error-notice';

interface Features {
  aiEnabled: boolean;
  aiLabEnabled: boolean;
}

interface Health {
  enabled: boolean;
  provider: { chat: string; embed: string };
  ollamaUrl: string;
  reachable: boolean;
  version: string | null;
  modelsAvailable: string[];
  modelsLoaded: string[];
  chatModelOk: boolean;
  embedModelOk: boolean;
  latencyMs: number;
  diagnosticsError: string | null;
}

interface Metrics {
  tokensIn: number;
  tokensOut: number;
  seconds: number;
  tokensPerSecond: number | null;
  loadMs: number;
  provider: string;
  model: string;
}

interface ChatResult {
  response: string;
  metrics: Metrics;
}

interface EmbedResult {
  dimension: number;
  first5: number[];
  ms: number;
  provider: string;
  model: string;
}

interface SimilarityResult {
  similarity: number;
  percent: number;
  dimension: number;
  ms: number;
}

interface TicketRow {
  id: string;
  title: string;
  ticketNumber?: number | null;
  createdAt?: string | null;
  status?: string;
  priority?: string;
  category?: string | null;
}

interface TicketSnapshot {
  id: string;
  numero: string;
  titulo: string;
  estado: string;
  prioridad: string;
  categoria: string | null;
  tecnico: string | null;
  mensajes: number;
}

interface SummaryResult {
  ticket: TicketSnapshot;
  summary: { pedido: string; probado: string; falta: string; cliente: string };
  metrics: Metrics;
}

interface ClassifyResult {
  ticket: TicketSnapshot;
  ai: Record<string, unknown> | null;
  raw: string | null;
  metrics: Metrics;
}

interface BenchResult {
  chat: {
    seconds: { average: number; min: number; max: number };
    tokensPerSecond: { average: number; min: number; max: number };
    details: Array<{ prompt: string; seconds: number; tokensPerSecond: number | null }>;
  };
  embeddings: { seconds: { average: number; min: number; max: number } };
  provider: { chat: string; embed: string };
  model: { chat: string; embed: string };
}

const AVISO =
  'Modelo local en CPU: cada respuesta puede tardar. Nada de lo que se hace acá modifica datos ni se envía a clientes.';

function messageOf(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return (e as Error)?.message || 'Error inesperado';
}

export default function AdminAiLabPage() {
  const { user, loading: authLoading } = useAuth();
  const { push } = useToast();
  const [features, setFeatures] = useState<Features | null>(null);
  const [error, setError] = useState('');

  const [health, setHealth] = useState<Health | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);

  const [prompt, setPrompt] = useState('¿Qué es un switch de red? Una frase.');
  const [chat, setChat] = useState<ChatResult | null>(null);
  const [chatBusy, setChatBusy] = useState(false);

  const [ticketQuery, setTicketQuery] = useState('');
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [ticketId, setTicketId] = useState('');
  const [ticketBusy, setTicketBusy] = useState(false);
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [classification, setClassification] = useState<ClassifyResult | null>(null);

  const [simA, setSimA] = useState('impresora del laboratorio no imprime');
  const [simB, setSimB] = useState('no sale nada por la impresora');
  const [similarity, setSimilarity] = useState<SimilarityResult | null>(null);
  const [simBusy, setSimBusy] = useState(false);

  const [bench, setBench] = useState<BenchResult | null>(null);
  const [benchBusy, setBenchBusy] = useState(false);

  const [elapsed, setElapsed] = useState(0);
  const busy = healthBusy || chatBusy || ticketBusy || simBusy || benchBusy;
  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    api
      .get<Features>('/ai/features')
      .then((f) => setFeatures(f))
      .catch(() => setFeatures({ aiEnabled: false, aiLabEnabled: false }));
  }, []);

  const loadHealth = useCallback(() => {
    setHealthBusy(true);
    setError('');
    api
      .get<Health>('/ai/health')
      .then(setHealth)
      .catch((e) => setError(messageOf(e)))
      .finally(() => setHealthBusy(false));
  }, []);

  useEffect(() => {
    if (features?.aiLabEnabled) loadHealth();
  }, [features, loadHealth]);

  if (authLoading || !features) {
    return (
      <Shell>
        <div className="empty">cargando…</div>
      </Shell>
    );
  }

  const allowed = user?.role === 'Administrador' && features.aiLabEnabled;
  if (!allowed) {
    return (
      <Shell>
        <PageHeader title="Laboratorio de IA" subtitle="Herramienta de diagnóstico" />
        <Card>
          <Empty message="Laboratorio de IA no disponible. Requiere rol Administrador y AI_LAB_ENABLED=true." />
        </Card>
      </Shell>
    );
  }

  const runChat = () => {
    setChatBusy(true);
    setError('');
    api
      .post<ChatResult>('/ai/lab/chat', { prompt })
      .then(setChat)
      .catch((e) => setError(messageOf(e)))
      .finally(() => setChatBusy(false));
  };

  const searchTicket = () => {
    setTicketBusy(true);
    setError('');
    api
      .get<{ items: TicketRow[] }>(
        `/tickets?search=${encodeURIComponent(ticketQuery)}&tray=all&take=5`,
      )
      .then((r) => setTickets(r?.items || []))
      .catch((e) => setError(messageOf(e)))
      .finally(() => setTicketBusy(false));
  };

  const summarize = () => {
    if (!ticketId) return;
    setTicketBusy(true);
    setError('');
    api
      .post<SummaryResult>(`/ai/lab/ticket/${ticketId}/summarize`)
      .then(setSummary)
      .catch((e) => setError(messageOf(e)))
      .finally(() => setTicketBusy(false));
  };

  const classify = () => {
    if (!ticketId) return;
    setTicketBusy(true);
    setError('');
    api
      .post<ClassifyResult>(`/ai/lab/ticket/${ticketId}/classify`)
      .then(setClassification)
      .catch((e) => setError(messageOf(e)))
      .finally(() => setTicketBusy(false));
  };

  const runSimilarity = () => {
    setSimBusy(true);
    setError('');
    api
      .post<SimilarityResult>('/ai/lab/similarity', { a: simA, b: simB })
      .then(setSimilarity)
      .catch((e) => setError(messageOf(e)))
      .finally(() => setSimBusy(false));
  };

  const runBenchmark = () => {
    setBenchBusy(true);
    setError('');
    api
      .post<BenchResult>('/ai/lab/benchmark')
      .then((r) => {
        setBench(r);
        push({ title: 'Benchmark terminado', tone: 'success' });
      })
      .catch((e) => setError(messageOf(e)))
      .finally(() => setBenchBusy(false));
  };

  const copyResults = async () => {
    if (!bench) return;
    const text = [
      'Laboratorio de IA — benchmark local',
      `proveedores: chat=${bench.provider.chat} embed=${bench.provider.embed}`,
      `modelos: chat=${bench.model.chat} embed=${bench.model.embed}`,
      `chat segundos: promedio=${bench.chat.seconds.average} min=${bench.chat.seconds.min} max=${bench.chat.seconds.max}`,
      `chat tokens/seg: promedio=${bench.chat.tokensPerSecond.average} min=${bench.chat.tokensPerSecond.min} max=${bench.chat.tokensPerSecond.max}`,
      `embeddings segundos: promedio=${bench.embeddings.seconds.average} min=${bench.embeddings.seconds.min} max=${bench.embeddings.seconds.max}`,
      ...bench.chat.details.map(
        (d) => `- ${d.prompt} | ${d.seconds}s | ${d.tokensPerSecond ?? 'n/a'} tok/s`,
      ),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      push({ title: 'Resultados copiados', tone: 'success' });
    } catch {
      setError('No se pudo copiar al portapapeles');
    }
  };

  return (
    <Shell>
      <PageHeader
        title="Laboratorio de IA"
        subtitle="Pruebas con Ollama local, sin modificar datos ni enviar mensajes a clientes"
      />
      <div className="notice" style={{ marginBottom: 16 }}>
        {AVISO}
      </div>
      {error && <ErrorNotice message={error} onDismiss={() => setError('')} autoHideMs={0} />}
      {busy && (
        <div className="notice" style={{ marginBottom: 16 }}>
          Pensando… ({elapsed} s)
        </div>
      )}

      <div className="grid-2" style={{ display: 'grid', gap: 16 }}>
        <Card title="Estado de Ollama" meta={health?.ollamaUrl}>
          {!health ? (
            <Empty message="sin datos" />
          ) : (
            <>
              <div className="flex wrap" style={{ gap: 8, marginBottom: 10 }}>
                <Pill style={health.reachable ? 'pill-green' : 'pill-red'}>
                  {health.reachable ? 'Ollama alcanzable' : 'Ollama no disponible'}
                </Pill>
                <Pill style={health.chatModelOk ? 'pill-green' : 'pill-amber'}>
                  chat: {health.chatModelOk ? 'ok' : 'falta modelo'}
                </Pill>
                <Pill style={health.embedModelOk ? 'pill-green' : 'pill-amber'}>
                  embeddings: {health.embedModelOk ? 'ok' : 'falta modelo'}
                </Pill>
              </div>
              <p>
                <strong>Versión:</strong> {health.version || '—'} · <strong>Latencia:</strong>{' '}
                {health.latencyMs} ms
              </p>
              <p>
                <strong>Proveedores:</strong> chat={health.provider.chat}, embed=
                {health.provider.embed}
              </p>
              <p>
                <strong>Modelos disponibles:</strong> {health.modelsAvailable.join(', ') || '—'}
              </p>
              <p>
                <strong>Cargados en memoria:</strong> {health.modelsLoaded.join(', ') || '—'}
              </p>
              {health.diagnosticsError && (
                <p className="notice notice-error">{health.diagnosticsError}</p>
              )}
            </>
          )}
          <button className="btn btn-sm" onClick={loadHealth} disabled={busy}>
            Reintentar
          </button>
        </Card>

        <Card title="Chat de prueba">
          <textarea
            className="input"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div style={{ marginTop: 8 }}>
            <button className="btn btn-primary" onClick={runChat} disabled={busy}>
              Enviar
            </button>
          </div>
          {chat && (
            <div style={{ marginTop: 12 }}>
              <p style={{ whiteSpace: 'pre-wrap' }}>{chat.response}</p>
              <p>
                tokens in/out: {chat.metrics.tokensIn}/{chat.metrics.tokensOut} · segundos:{' '}
                {chat.metrics.seconds} · tokens/seg: {chat.metrics.tokensPerSecond ?? 'n/a'} ·
                carga modelo: {chat.metrics.loadMs} ms · modelo: {chat.metrics.model}
              </p>
            </div>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card title="Ticket real: resumir y clasificar">
          <div className="flex wrap" style={{ gap: 8 }}>
            <input
              className="input"
              style={{ maxWidth: 320 }}
              placeholder="buscar por número (TK-2026-123)…"
              value={ticketQuery}
              onChange={(e) => setTicketQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchTicket()}
            />
            <button className="btn" onClick={searchTicket} disabled={busy}>
              Buscar
            </button>
          </div>
          {tickets.length > 0 && (
            <table className="table" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>número</th>
                  <th>título</th>
                  <th>estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id}>
                    <td>{ticketNumberDisplay(t)}</td>
                    <td>{t.title}</td>
                    <td>{t.status}</td>
                    <td>
                      <button className="btn btn-sm" onClick={() => setTicketId(t.id)}>
                        elegir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {ticketId && (
            <>
              <p style={{ marginTop: 10 }}>
                <strong>Ticket elegido:</strong> {ticketId}
              </p>
              <div className="flex wrap" style={{ gap: 8 }}>
                <button className="btn btn-primary" onClick={summarize} disabled={busy}>
                  Resumir
                </button>
                <button className="btn btn-primary" onClick={classify} disabled={busy}>
                  Clasificar
                </button>
              </div>
            </>
          )}
          {summary && (
            <div style={{ marginTop: 12 }}>
              <h4>Datos reales</h4>
              <p>{JSON.stringify(summary.ticket)}</p>
              <h4>Resumen de la IA</h4>
              <p style={{ whiteSpace: 'pre-wrap' }}>
                {`Pedido: ${summary.summary.pedido}\nProbado: ${summary.summary.probado}\nFalta: ${summary.summary.falta}\nCliente: ${summary.summary.cliente}`}
              </p>
              <p>
                tokens in/out: {summary.metrics.tokensIn}/{summary.metrics.tokensOut} · segundos:{' '}
                {summary.metrics.seconds}
              </p>
            </div>
          )}
          {classification && (
            <div style={{ marginTop: 12 }}>
              <h4>Datos reales</h4>
              <p>{JSON.stringify(classification.ticket)}</p>
              <h4>Clasificación de la IA</h4>
              <p style={{ whiteSpace: 'pre-wrap' }}>
                {classification.ai
                  ? JSON.stringify(classification.ai, null, 2)
                  : classification.raw || 'sin resultado'}
              </p>
              <p>segundos: {classification.metrics.seconds}</p>
            </div>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card title="Similitud de embeddings">
          <input className="input" value={simA} onChange={(e) => setSimA(e.target.value)} />
          <input
            className="input"
            style={{ marginTop: 8 }}
            value={simB}
            onChange={(e) => setSimB(e.target.value)}
          />
          <div style={{ marginTop: 8 }}>
            <button className="btn btn-primary" onClick={runSimilarity} disabled={busy}>
              Comparar
            </button>
          </div>
          {similarity && (
            <p style={{ marginTop: 10 }}>
              similitud: <strong>{similarity.percent}%</strong> ({similarity.similarity}) · dim=
              {similarity.dimension} · {similarity.ms} ms
            </p>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card title="Benchmark (5 chats + 5 embeddings)">
          <div className="flex wrap" style={{ gap: 8 }}>
            <button className="btn btn-primary" onClick={runBenchmark} disabled={busy}>
              Correr benchmark
            </button>
            <button className="btn" onClick={copyResults} disabled={!bench || busy}>
              Copiar resultados
            </button>
          </div>
          {bench && (
            <>
              <p style={{ marginTop: 10 }}>
                chat: promedio {bench.chat.seconds.average}s (min {bench.chat.seconds.min}s / max{' '}
                {bench.chat.seconds.max}s) · tokens/seg promedio{' '}
                {bench.chat.tokensPerSecond.average}
              </p>
              <p>
                embeddings: promedio {bench.embeddings.seconds.average}s (min{' '}
                {bench.embeddings.seconds.min}s / max {bench.embeddings.seconds.max}s)
              </p>
              <table className="table">
                <thead>
                  <tr>
                    <th>pedido</th>
                    <th>segundos</th>
                    <th>tokens/seg</th>
                  </tr>
                </thead>
                <tbody>
                  {bench.chat.details.map((d) => (
                    <tr key={d.prompt}>
                      <td>{d.prompt}</td>
                      <td>{d.seconds}</td>
                      <td>{d.tokensPerSecond ?? 'n/a'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Card>
      </div>
    </Shell>
  );
}
