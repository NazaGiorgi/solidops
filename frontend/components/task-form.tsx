'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PRIORITY_LABELS, RECURRENCE_LABELS } from '../lib/helpers';

export interface TaskFormDefaults {
  assigneeId?: string | null;
  relatedEntityType?: 'ticket' | 'customer' | null;
  relatedEntityId?: string | null;
}

interface Assignee {
  id: string;
  name: string;
}

// Modal reutilizable para crear una Tarea (no un turno) desde Agenda, ticket o cliente.
export function TaskForm({
  defaults = {},
  onClose,
  onSaved,
}: {
  defaults?: TaskFormDefaults;
  onClose: () => void;
  onSaved: (task?: { id: string; title: string; dueAt?: string | null }) => void;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState(defaults.assigneeId ?? user?.id ?? '');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [priority, setPriority] = useState('normal');
  const [recurrenceRule, setRecurrenceRule] = useState('none');
  const [notes, setNotes] = useState('');
  const [relatedType, setRelatedType] = useState<'ticket' | 'customer' | ''>(
    defaults.relatedEntityType ?? '',
  );
  const [relatedId, setRelatedId] = useState(defaults.relatedEntityId ?? '');
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<Array<{ userId?: string | null; user?: { name?: string } }>>('/technicians')
      .then((techs) => {
        const options: Assignee[] = [];
        for (const t of techs || []) {
          if (t.userId) options.push({ id: t.userId, name: t.user?.name || '—' });
        }
        if (user && !options.some((o) => o.id === user.id)) {
          options.unshift({ id: user.id, name: user.name });
        }
        setAssignees(options);
      })
      .catch(() => {
        setAssignees(user ? [{ id: user.id, name: user.name }] : []);
      });
  }, [user]);

  function validate(): string {
    const clean = title.trim();
    if (!clean) return 'El título es obligatorio';
    if (clean.length > 200) return 'El título no puede superar los 200 caracteres';
    if (relatedType && !['ticket', 'customer'].includes(relatedType)) {
      return 'La tarea sólo puede vincularse a un ticket o a un cliente';
    }
    if (relatedType && !relatedId) return 'Falta el ticket o cliente vinculado';
    if (assigneeId && !assignees.some((a) => a.id === assigneeId)) {
      return 'El responsable debe ser un usuario interno activo';
    }
    return '';
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try {
      const created = await api.post<{ id: string; title: string; dueAt?: string | null }>('/tasks', {
        title: title.trim(),
        assigneeId: assigneeId || null,
        dueAt: dueDate ? new Date(`${dueDate}T${dueTime || '09:00'}`).toISOString() : null,
        priority,
        recurrenceRule,
        notes: notes.trim() || null,
        relatedEntityType: relatedType || null,
        relatedEntityId: relatedType ? relatedId : null,
      });
      onSaved(created);
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  }

  const link = relatedType && relatedId ? `/${relatedType === 'ticket' ? 'tickets' : 'clientes'}/${relatedId}` : '';

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head flex-between">
          <h3 className="card-title" style={{ margin: 0 }}>Nueva tarea</h3>
          <button type="button" className="notice-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body stack" style={{ gap: 10 }}>
            {error && <div className="notice notice-error">{error}</div>}
            <div className="field">
              <label>Título *</label>
              <input
                className="input"
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="ej. Presupuestar repuesto"
              />
            </div>
            <div className="grid-auto">
              <div className="field">
                <label>Responsable</label>
                <select className="select" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                  <option value="">sin asignar</option>
                  {assignees.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}{a.id === user?.id ? ' (yo)' : ''}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Prioridad</label>
                <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid-auto">
              <div className="field">
                <label>Vence</label>
                <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div className="field">
                <label>Hora (opcional)</label>
                <input className="input" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label>Se repite</label>
              <select className="select" value={recurrenceRule} onChange={(e) => setRecurrenceRule(e.target.value)}>
                {Object.entries(RECURRENCE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Notas</label>
              <textarea className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {link ? (
              <div className="flex-between" style={{ gap: 8 }}>
                <span className="muted" style={{ fontSize: 13 }}>
                  Vinculada a {relatedType}: <Link href={link} className="link">{relatedId}</Link>
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => { setRelatedType(''); setRelatedId(''); }}
                >
                  desvincular
                </button>
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 13 }}>Sin vínculo con ticket ni cliente</div>
            )}
          </div>
          <div className="modal-foot flex justify-end" style={{ gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>cancelar</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'creando…' : 'crear tarea'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
