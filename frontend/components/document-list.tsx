'use client';
import { useEffect, useState } from 'react';
import { api, getToken, API_URL } from '../lib/api';
import { Card, Empty, Pill } from './ui';
import { ErrorNotice } from './error-notice';

interface DocVersion {
  id: string;
  versionNumber: number;
  rawFilename: string | null;
  sizeBytes: number;
  createdAt: string;
}
interface DocumentRow {
  id: string;
  title: string;
  rawFilename: string | null;
  mimeType: string | null;
  sizeBytes: number;
  categoryPath: string | null;
  documentType: string;
  sensitive: boolean;
  status: string;
  updatedAt: string;
}

const TYPE_LABEL: Record<string, string> = {
  manual: 'manual',
  diagrama: 'diagrama',
  credenciales: 'credenciales',
  otro: 'otro',
};

// Document list for a customer (used in the Client 360 "box"). Handles download
// (with audit for sensitive docs) and versioning without leaving the screen.
export function DocumentList({ customerId }: { customerId: string }) {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function load() {
    api
      .get<DocumentRow[]>(`/documents?customerId=${customerId}`)
      .then(setDocs)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  async function download(id: string) {
    try {
      // Records access (audit) for sensitive docs.
      await api.post(`/documents/${id}/view`, {});
      // Fetch del archivo con el Bearer token, servido por el backend (lee de
      // MinIO). Crea un <a download> para descargar el blob.
      const token = getToken();
      const res = await fetch(`${API_URL}/api/documents/${id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('No se pudo descargar el archivo');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card title="Documentos" meta={`${docs.length}`}>
      {error && <ErrorNotice message={error} onDismiss={() => setError('')} />}
      {loading ? (
        <div className="empty">cargando…</div>
      ) : docs.length === 0 ? (
        <Empty message="Sin documentos para este cliente todavía" />
      ) : (
        <div className="stack">
          {docs.map((d) => (
            <div key={d.id} className="flex-between" style={{ alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 500 }}>
                  {d.title}
                  {d.sensitive && (
                    <Pill style="pill-red" > 🔒 credenciales</Pill>
                  )}
                </div>
                <div className="card-meta">
                  {TYPE_LABEL[d.documentType] || d.documentType} · {d.rawFilename || '—'} · {Math.round((d.sizeBytes || 0) / 1024)} KB
                </div>
              </div>
              <div className="flex" style={{ gap: 6 }}>
                <a className="btn btn-sm" href={`/documentos?cliente=${customerId}`}>ver</a>
                <button className="btn btn-sm" onClick={() => download(d.id)}>
                  descargar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8">
        <a href={`/documentos?cliente=${customerId}`} className="link" style={{ fontSize: 13 }}>abrir explorador de Documentos →</a>
      </div>
    </Card>
  );
}

export { TYPE_LABEL };
