'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, API_URL, getToken } from '../../../lib/api';
import { Shell } from '../shell';
import { PageHeader, Card, Empty, Pill } from '../../../components/ui';
import { ErrorNotice } from '../../../components/error-notice';

interface DocItem {
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
interface Folder {
  folder: string;   // ruta de carpetas ('' = raíz)
  list: DocItem[];
}
interface TreeGroup {
  id: string | null;
  name: string;
  children: Folder[];
}

type Nav = { kind: 'general' } | { kind: 'general-view' } | { kind: 'customer'; id: string; name: string };
type Preview = { id: string; name: string; kind: 'inline' | 'office' | null } | null;

const TYPE_LABEL: Record<string, string> = { manual: 'manual', diagrama: 'diagrama', credenciales: 'credenciales', otro: 'otro' };
const OFFLINE_OK = /(pdf|png|jpe?g|gif|webp|bmp|svg)$/i;
const OFFICE = /(docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt)$/i;

export default function DocumentsPage() {
  const [tree, setTree] = useState<TreeGroup[] | null>(null);
  const [search, setSearch] = useState('');
  const [nav, setNav] = useState<Nav>({ kind: 'general' });
  const [path, setPath] = useState<string[]>([]);   // carpetas dentro del cliente ("Informes","por empresa",...)
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uploading, setUploading] = useState(false);
  const [newFolder, setNewFolder] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [preview, setPreview] = useState<Preview>(null);
  const [previewSrc, setPreviewSrc] = useState<{ url: string; type: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewMsg, setPreviewMsg] = useState('');
  const previewUrlRef = useRef('');
  // Token de generación: cada openPreview le asigna un id único. Si dos llamadas
  // se superponen (abrir A, y enseguida B, o re-click en la misma), solo se
  // aplica el resultado de la MÁS RECIENTE. Sin esto, una respuesta rápida (cachead)
  // podía escribirse en el modal DESPUÉS de una más lenta, causando contenido
  // mezclado o binario de una generación anterior.
  const previewReqRef = useRef(0);

  function load() {
    api.get<TreeGroup[]>('/documents/explorer/tree').then(setTree).catch((e) => setError((e as Error).message));
  }
  useEffect(() => { load(); }, []);

  // Deep-link opcional: /documentos?cliente=<id> abre directo el explorador de un cliente.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const cid = new URLSearchParams(window.location.search).get('cliente');
    if (!cid) return;
    const guest = (cid ?? '').trim();
    // validación mínima de formato UUID para no romper el find con un navegador corrupto
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(guest)) return;
    setNav({ kind: 'customer', id: guest, name: '' });
    setPath([]);
  }, []);

  // Carpeta actual (nodo) según nav + path.
  const folder = useMemo(() => {
    if (!tree || !Array.isArray(tree)) return null;
    const group = nav.kind === 'customer' ? tree.find((g) => g.id === nav.id) : tree.find((g) => g.id === null);
    if (!group || !Array.isArray(group.children)) return null;
    const folders: Folder[] = group.children;
    if (path.length === 0) {
      return { folders: folders.filter((f) => f.folder !== ''), files: folders.find((f) => f.folder === '')?.list ?? [] };
    }
    const prefix = path.join('/');
    const sub = folders.filter((f) => f.folder.startsWith(prefix + '/')).map((f) => ({ folder: f.folder.slice(prefix.length + 1), list: f.list }));
    const here = folders.find((f) => f.folder === prefix);
    return { folders: sub.filter((f) => f.folder !== ''), files: (here?.list ?? []).concat(sub.filter((f) => f.folder === '').flatMap((f) => f.list)) ?? [] };
  }, [tree, nav, path]);

  // Subcarpetas directas de la carpeta actual (primer segmento de cada ruta restante).
  const subfolders = useMemo(() => {
    if (!folder) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const f of folder.folders) {
      const first = f.folder.split('/')[0];
      if (first && !seen.has(first)) { seen.add(first); out.push(first); }
    }
    return out;
  }, [folder]);

  const files = useMemo(() => (folder?.files ?? []), [folder]);

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true); setError(''); setNotice('');
    try {
      const form = new FormData();
      form.append('file', f);
      if (nav.kind === 'customer') form.append('customerId', nav.id);
      // category_path = ruta de carpetas actual + nombre del archivo (último
      // tramo = archivo). Si vamos en la raíz del cliente, queda solo el archivo;
      // si estamos dentro de una carpeta, queda carpeta/archivo.
      form.append('categoryPath', [...path, f.name].join('/'));
      form.append('title', f.name.replace(/\.[^.]+$/, ''));
      await api.post('/documents/upload', form);
      setNotice('Documento subido');
      setTimeout(() => setNotice(''), 2500);
      load();
    } catch (err) { setError((err as Error).message); }
    finally { setUploading(false); e.target.value = ''; }
  }

  // Crea una carpeta nueva en la ubicación actual (categoría reservada, sin
  // contenido). El categoryPath se arma con la ruta donde está parado el usuario.
  async function createFolder() {
    const name = (newFolder || '').trim();
    if (!name) return;
    setCreatingFolder(true); setError(''); setNotice('');
    try {
      const rel = nav.kind === 'customer' ? [...path, name].join('/') : [...path, name].join('/');
      const payload: Record<string, string> = { title: name, categoryPath: rel || name };
      if (nav.kind === 'customer') payload.customerId = nav.id;
      await api.post('/documents/folder', payload);
      setNotice('Carpeta creada');
      setNewFolder('');
      setTimeout(() => setNotice(''), 2500);
      load();
    } catch (err) { setError((err as Error).message); }
    finally { setCreatingFolder(false); }
  }

  function openFolder(name: string) { closePreview(); setPath((p) => [...p, name]); }
  function goPath(i: number) { closePreview(); setPath((p) => p.slice(0, i)); }
  function backToCustomer(name: string, id: string) { setNav({ kind: 'customer', id, name }); setPath([]); closePreview(); }
  // Al elegir un cliente (o Recursos generales) desde la vista inicial.
  function onOpenGroup(id: string | null, name: string) {
    closePreview();
    setPath([]);
    if (id == null) setNav({ kind: 'general-view' });
    else setNav({ kind: 'customer', id, name: name === 'Cliente' ? '' : name });
  }
  // Volver a la vista de clientes desde el breadcrumb raíz.
  function backToRoot() { closePreview(); setPath([]); setNav({ kind: 'general' }); }

  async function openPreview(d: DocItem) {
    // Generación: esta llamada es la N. Si mientras tanto se abrió otra (o se
    // re-cliqueó), los avisos/resultados de esta se descartan al volver (ver
    // checks `req !== previewReqRef.current`).
    const req = ++previewReqRef.current;
    setPreview({ id: d.id, name: d.rawFilename || d.title, kind: null });
    setPreviewLoading(true); setPreviewSrc(null); setPreviewMsg('');
    try {
      await api.post(`/documents/${d.id}/view`, {}); // audita acceso en sensibles
      if (req !== previewReqRef.current) return; // superada por una apertura más nueva
      const ext = (d.rawFilename || '').split('.').pop()?.toLowerCase() || '';
      const file = d.rawFilename || '';
      if (OFFICE.test(file) || OFFLINE_OK.test(ext)) {
        const blob = await fetchPreviewBlob(d.id);
        if (req !== previewReqRef.current) return; // obsoleto; no aplicar
        const url = URL.createObjectURL(blob);
        // Liberar el blob anterior ANTES de exponer el nuevo, para no dejar
        // dos URLs vivas en paralelo (origen de contenido mezclado).
        if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = ''; }
        // type se deduce del contenido (PDF o imagen). Usamos <object> real (no
        // dangerouslySetInnerHTML): React maneja el elemento y evita recrearlo
        // en cada re-render (que era lo que disparaba el reload del blob según el
        // timing). El blob queda vivo mientras dura la preview (se revoca en close).
        const type = /^image\//.test(blob.type) ? blob.type : 'application/pdf';
        previewUrlRef.current = url;
        setPreviewSrc({ url, type });
        setPreview((p) => (p ? { ...p, kind: type.startsWith('image/') ? null : 'inline' } : p));
      } else {
        setPreviewMsg('Este formato no tiene vista previa en el navegador. Usá el botón "descargar".');
      }
    } catch (e) {
      if (req !== previewReqRef.current) return; // obsoleto
      setPreviewMsg((e as Error).message || 'No se pude previsualizar. Podés descargar el archivo.');
    } finally {
      if (req === previewReqRef.current) setPreviewLoading(false);
    }
  }

  function API_PREVIEW(id: string) { return `/api/documents/${id}/preview`; }
  function API_DOWNLOAD(id: string) { return `/api/documents/${id}/download`; }

  async function fetchPreviewBlob(id: string): Promise<Blob> {
    const token = getToken();
    const res = await fetch(`${API_URL}${API_PREVIEW(id)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      // Backend de error devuelve JSON { message } o, a veces, un cuerpo no-JSON.
      const text = await res.text().catch(() => '');
      let message = 'No se pudo previsualizar';
      try { message = JSON.parse(text)?.message || message; } catch { /* no-JSON: mensaje genérico */ }
      throw new Error(message);
    }
    const blob = await res.blob();
    // Blindaje: si el backend devolvió algo que NO es PDF ni imagen (p.ej. el
    // binario original de un .docx sin convertir), NO lo renderizamos como texto:
    // mejor mostrar el mensaje claro de "no se pudo previsualizar".
    const ct = (blob.type || '').toLowerCase();
    const isPdf = ct === 'application/pdf';
    const isImage = /^image\//.test(ct);
    if (!isPdf && !isImage) {
      throw new Error('No se pudo previsualizar este archivo');
    }
    return blob;
  }

  function closePreview() {
    if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = ''; }
    setPreview(null);
    setPreviewSrc(null);
    setPreviewMsg('');
  }

  // Descarga por el backend con el Bearer token (un <a href> plano no manda el
  // token y el endpoint /download responde 401 -> el navegador guarda "preview.htm").
  async function downloadDoc(id: string) {
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/documents/${id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('No se pudo descargar');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Usar el filename del Content-Disposition (ej. "SLA....pdf"), no uno
      // genérico: así se guarda el archivo real, nunca "preview.htm".
      const cd = res.headers.get('content-disposition') || '';
      const m = cd.match(/filename\*?=(?:"([^"]+)"|([^;]+))/i);
      const filename = decodeURIComponent((m && (m[1] || m[2]))?.trim() || 'documento');
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setPreviewMsg((e as Error).message || 'No se pudo descargar');
    }
  }

  if (!tree) return <Shell><div className="empty">cargando…</div></Shell>;

  // Nombre del cliente (desde el deep-link puede venir vacío hasta que cargue el tree).
  const activeGroup = nav.kind === 'customer' ? tree.find((g) => g.id === nav.id) : null;
  const customerName = nav.kind === 'customer' ? (nav.name || activeGroup?.name || 'Cliente') : '';
  const breadcrumb = nav.kind === 'customer' ? [customerName, ...path] : nav.kind === 'general-view' ? ['Recursos generales', ...path] : [];

  return (
    <Shell>
      <PageHeader title="Documentos" subtitle="Documentación de clientes y recursos generales" action={
        <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
          {uploading ? 'subiendo…' : '+ subir documento'}
          <input type="file" style={{ display: 'none' }} onChange={uploadFile} />
        </label>
      }/>
      {notice && <div className="notice">{notice}</div>}
      {error && <ErrorNotice message={error} onDismiss={() => setError('')} />}

      <div className="flex wrap mb-16" style={{ gap: 8, alignItems: 'center' }}>
        {/* Breadcrumb tipo Explorer */}
        {breadcrumb.map((seg, i) => (
          <span key={i} className="flex" style={{ gap: 6, alignItems: 'center' }}>
            {i > 0 && <span className="muted">/</span>}
            {i < breadcrumb.length - 1 ? (
              <button className="link" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }} onClick={() => { if (i === 0 && nav.kind === 'customer') backToCustomer(nav.name, nav.id); else if (i > 0) goPath(i - 1); }}>
                {seg}
              </button>
            ) : (
              <span style={{ fontWeight: 600 }}>{seg}</span>
            )}
          </span>
        ))}
        <input className="input" style={{ marginLeft: 'auto', maxWidth: 260 }} placeholder="buscar…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex" style={{ gap: 6 }}>
          <input
            className="input"
            style={{ maxWidth: 180 }}
            placeholder="nueva carpeta…"
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createFolder()}
          />
          <button className="btn btn-sm" onClick={createFolder} disabled={creatingFolder}>
            {creatingFolder ? 'creando…' : '+ carpeta'}
          </button>
        </div>
      </div>

      {/* Vista del navegador */}
      {nav.kind === 'general' ? (
        // Vista inicial: lista de CLIENTES con documentos (+ Recursos generales).
        <Card title="Clientes con documentos" meta={`${tree.length} entradas`}>
          <div className="grid-auto">
            {tree.map((g) => {
              const isGeneral = g.id == null;
              const label = isGeneral ? 'Recursos generales' : (g.name || 'Cliente');
              return (
                <button key={isGeneral ? 'general' : g.id} className="card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => onOpenGroup(g.id, label)}>
                  <div style={{ fontSize: 22 }}>{isGeneral ? '🗂️' : '📁'}</div>
                  <div style={{ fontWeight: 600, marginTop: 6 }}>{label}</div>
                  <div className="card-meta" style={{ marginTop: 4 }}>{g.children.length} carpetas</div>
                </button>
              );
            })}
          </div>
        </Card>
      ) : (
        <Card title={breadcrumb.join(' / ')} meta={`${subfolders.length} carpetas · ${files.length} archivos`}>
          {subfolders.length === 0 && files.length === 0 ? (
            <Empty message="Carpeta vacía" />
          ) : (
            <div className="grid-auto">
              {subfolders.map((sf) => (
                <button key={sf} className="card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => openFolder(sf)}>
                  <div style={{ fontSize: 22 }}>📁</div>
                  <div style={{ fontWeight: 600, marginTop: 6 }}>{sf}</div>
                </button>
              ))}
              {files.map((d) => (
                <div key={d.id} className="card" style={{ cursor: 'pointer' }} onClick={() => openPreview(d)}>
                  <div className="flex-between">
                    <div style={{ fontWeight: 500 }}>
                      {d.title}
                      {d.sensitive && <Pill style="pill-red"> 🔒</Pill>}
                    </div>
                    <span className="card-meta">{Math.round((d.sizeBytes || 0) / 1024)} KB</span>
                  </div>
                  <div className="card-meta" style={{ marginTop: 6 }}>
                    {TYPE_LABEL[d.documentType] || d.documentType} · {(d.rawFilename || '—')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Panel de vista previa */}
      {preview && (
        <div className="modal-overlay" onClick={() => !previewLoading && closePreview()}>
          <div className="modal" style={{ maxWidth: 900, minHeight: 500 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head flex-between">
              <h3 className="card-title" style={{ margin: 0 }}>{preview.name}</h3>
              <div className="flex" style={{ gap: 8 }}>
                <button className="btn btn-sm" onClick={() => downloadDoc(preview.id)}>descargar</button>
                <button className="notice-close" onClick={closePreview} aria-label="Cerrar">×</button>
              </div>
            </div>
            <div style={{ height: 420 }}>
              {previewLoading ? <div className="empty">generando vista previa…</div>
                : previewMsg ? <div className="empty">{previewMsg}</div>
                : previewSrc ? (
                  <object
                    data={previewSrc.url}
                    type={previewSrc.type}
                    style={{ width: '100%', height: '100%', border: 0, borderRadius: 8 }}
                  />
                ) : (
                  <div className="empty">generando vista previa…</div>
                )}
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
