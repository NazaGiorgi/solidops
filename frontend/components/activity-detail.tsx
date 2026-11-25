'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { ErrorNotice } from './error-notice';
import { TechnicianMultiSelect } from './technician-multi-select';
import {
  APPOINTMENT_TYPE_LABELS,
  APPOINTMENT_TYPE_PILLS,
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_PILLS,
  RECURRENCE_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUS_PILLS,
  formatDay,
} from '../lib/helpers';

export interface ModalItem {
  kind: 'appointment' | 'task';
  id: string;
}

// Reusable detail/edit modal for an appointment (turno) or a task.
// Opens on click from the agenda/dashboard; saves via PATCH and calls onSaved.
export function ActivityDetailModal({
  item,
  onClose,
  onSaved,
}: {
  item: ModalItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const [technicians, setTechnicians] = useState<Array<{ id: string; userId?: string | null; user?: { name?: string } }>>([]);
  const [customers, setCustomers] = useState<Array<{ id: string; name: string }>>([]);

  // appointment fields
  const [selectedTechIds, setSelectedTechIds] = useState<string[]>([]);
  const [form, setForm] = useState({
    type: 'visita',
    status: 'programado',
    subject: '',
    notes: '',
    customerId: '',
    technicianId: '',
    startAt: '',
    endAt: '',
    reminderMinutes: '0',
    isPrivate: false,
  });
  // Datos del creador del turno (para mostrarlo; los históricos pueden no tenerlo).
  const [apptMeta, setApptMeta] = useState<{ createdBy?: { name?: string } | null; isPrivate?: boolean }>({});
  // task fields
  const [taskForm, setTaskForm] = useState({
    title: '',
    status: 'pendiente',
    priority: 'normal',
    dueAt: '',
    notes: '',
    assigneeId: '',
    recurrenceRule: 'none',
  });
  const [taskMeta, setTaskMeta] = useState<{
    relatedEntityType?: 'ticket' | 'customer' | null;
    relatedEntityId?: string | null;
  }>({});

  useEffect(() => {
    api
      .get<Array<{ id: string; userId?: string | null; user?: { name?: string } }>>('/technicians')
      .then(setTechnicians)
      .catch(() => {});
    api.get<Array<{ id: string; name: string }>>('/customers').then(setCustomers).catch(() => {});
    // Assignees for tasks are technicians (a Técnico role does NOT have
    // users:read, so /users would 403 in a loop. Use /technicians instead,
    // which the Técnico role CAN read, and map to the technician's userId.)
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      if (item.kind === 'appointment') {
        const a = await api.get<{
          id: string; type: string; status: string; subject: string | null; notes: string | null;
          customerId: string | null; technicianId: string | null;
          technicianLinks?: Array<{ technicianId: string }>;
          startAt: string; endAt: string; reminderMinutes: number | null;
          isPrivate?: boolean; createdBy?: { name?: string } | null;
        }>(`/appointments/${item.id}`);
        const linkedIds = (a.technicianLinks ?? []).map((l) => l.technicianId);
        setSelectedTechIds(linkedIds.length ? linkedIds : a.technicianId ? [a.technicianId] : []);
        setForm({
          type: a.type || 'visita',
          status: a.status || 'programado',
          subject: a.subject || '',
          notes: a.notes || '',
          customerId: a.customerId || '',
          technicianId: a.technicianId || '',
          startAt: toLocalInput(a.startAt),
          endAt: toLocalInput(a.endAt),
          reminderMinutes: String(a.reminderMinutes ?? 0),
          isPrivate: !!a.isPrivate,
        });
        setApptMeta({ createdBy: a.createdBy, isPrivate: a.isPrivate });
      } else {
        const t = await api.get<{
          id: string; title: string; status: string; priority: string;
          dueAt: string | null; notes: string | null; assigneeId: string | null;
          recurrenceRule?: string | null;
          relatedEntityType?: 'ticket' | 'customer' | null;
          relatedEntityId?: string | null;
        }>(`/tasks/${item.id}`);
        setTaskForm({
          title: t.title || '',
          status: t.status || 'pendiente',
          priority: t.priority || 'normal',
          dueAt: t.dueAt ? toLocalInput(t.dueAt) : '',
          notes: t.notes || '',
          assigneeId: t.assigneeId || '',
          recurrenceRule: t.recurrenceRule || 'none',
        });
        setTaskMeta({
          relatedEntityType: t.relatedEntityType,
          relatedEntityId: t.relatedEntityId,
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      if (item.kind === 'appointment') {
        await api.patch(`/appointments/${item.id}`, {
          type: form.type,
          status: form.status,
          subject: form.subject || null,
          notes: form.notes || null,
          customerId: form.customerId || null,
          technicianId: selectedTechIds[0] || null,
          technicianIds: selectedTechIds,
          startAt: new Date(form.startAt).toISOString(),
          endAt: new Date(form.endAt).toISOString(),
          reminderMinutes: Number(form.reminderMinutes) || null,
          isPrivate: !!form.isPrivate,
        });
      } else {
        const res = await api.patch<{ next?: { dueAt?: string | null } }>(`/tasks/${item.id}`, {
          title: taskForm.title,
          status: taskForm.status,
          priority: taskForm.priority,
          dueAt: taskForm.dueAt ? new Date(taskForm.dueAt).toISOString() : null,
          notes: taskForm.notes || null,
          assigneeId: taskForm.assigneeId || null,
          recurrenceRule: taskForm.recurrenceRule,
        });
        setNotice(res?.next?.dueAt
          ? `Guardado · Próxima: ${formatDay(res.next.dueAt)}`
          : 'Guardado');
      }
      if (item.kind === 'appointment') setNotice('Guardado');
      setTimeout(() => {
        setNotice('');
        onSaved();
        onClose();
      }, 800);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteItem() {
    setBusy(true);
    setError('');
    try {
      await api.delete(`/appointments/${item.id}`);
      setNotice('Eliminado');
      setTimeout(() => {
        setNotice('');
        onSaved();
        onClose();
      }, 800);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  // P2: create a new ticket from this activity, pre-filled with the activity's
  // customer, technician and description. Only meaningful for appointments.
  async function createTicket() {
    if (item.kind !== 'appointment') return;
    if (!form.customerId) {
      setNotice('este turno no tiene cliente asociado');
      setTimeout(() => setNotice(''), 2500);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const newTicket = await api.post<{ id: string }>('/tickets', {
        customerId: form.customerId,
        technicianId: form.technicianId || undefined,
        title: form.subject || 'Ticket desde actividad',
        description:
          form.notes ||
          `Creado desde la actividad "${form.subject || 'sin título'}" del ${toLocalInput(form.startAt)}`,
      });
      setNotice('Ticket creado');
      setTimeout(() => {
        onClose();
        router.push(`/tickets/${newTicket.id}`);
      }, 600);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const isAppt = item.kind === 'appointment';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head flex-between">
          <h3 className="card-title" style={{ margin: 0 }}>
            {isAppt ? 'Editar turno' : 'Editar tarea'}
          </h3>
          <button className="notice-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        {error && <ErrorNotice message={error} onDismiss={() => setError('')} />}
        {notice && <div className="notice">{notice}</div>}
        {loading ? (
          <div className="empty">cargando…</div>
        ) : isAppt ? (
          <div className="modal-body">
            {form.startAt && (
              <div className="mb-8 flex wrap">
                <Pill style="pill-blue">{APPOINTMENT_TYPE_LABELS[form.type] || form.type}</Pill>
                <Pill style={APPOINTMENT_STATUS_PILLS[form.status] || 'pill-gray'}>
                  {APPOINTMENT_STATUS_LABELS[form.status] || form.status}
                </Pill>
                {form.isPrivate && <Pill style="pill-gray">🔒 privado</Pill>}
              </div>
            )}
            <div className="muted mb-8" style={{ fontSize: 12 }}>
              Creado por: {apptMeta.createdBy?.name || 'Creador desconocido'}
            </div>
            <div className="field">
              <label>Privado</label>
              <label className="flex" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.isPrivate} onChange={(e) => setForm({ ...form, isPrivate: e.target.checked })} />
                <span className="muted" style={{ fontSize: 13 }}>Privado (solo yo lo veo)</span>
              </label>
            </div>
            <div className="field">
              <label>Estado</label>
              <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="programado">programado</option>
                <option value="completado">completado</option>
                <option value="cancelado">cancelado</option>
                <option value="pospuesto">pospuesto</option>
              </select>
            </div>
            {form.status === 'pospuesto' && (
              <div className="muted mb-8" style={{ fontSize: 12 }}>
                Puede reprogramar ahora ajustando inicio/fin abajo, o dejarlo pospuesto y reprogramarlo más adelante.
              </div>
            )}
            <div className="field">
              <label>Tipo</label>
              <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {Object.keys(APPOINTMENT_TYPE_LABELS).map((k) => (
                  <option key={k} value={k}>{APPOINTMENT_TYPE_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Asunto</label>
              <input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </div>
            <div className="grid-3">
              <div className="field">
                <label>Inicio</label>
                <input className="input" type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} />
              </div>
              <div className="field">
                <label>Fin</label>
                <input className="input" type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} />
              </div>
            </div>
            <div className="grid-3">
              <div className="field">
                <label>Cliente</label>
                <select className="select" value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                  <option value="">sin cliente</option>
                  {customers.map((cu) => <option key={cu.id} value={cu.id}>{cu.name}</option>)}
                </select>
              </div>
              <div className="field">
                <TechnicianMultiSelect
                  technicians={technicians}
                  selected={selectedTechIds}
                  onChange={setSelectedTechIds}
                  label="Técnicos"
                />
              </div>
            </div>
            <div className="field">
              <label>Recordatorio</label>
              <select className="select" value={form.reminderMinutes} onChange={(e) => setForm({ ...form, reminderMinutes: e.target.value })}>
                <option value="0">sin recordatorio</option>
                <option value="10">10 min antes</option>
                <option value="15">15 min antes</option>
                <option value="30">30 min antes</option>
                <option value="60">1 hora antes</option>
              </select>
            </div>
            <div className="field">
              <label>Notas / descripción</label>
              <textarea className="textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <div className="mb-8 card-meta">
              <Pill style={TASK_STATUS_PILLS[taskForm.status] || 'pill-gray'}>
                {TASK_STATUS_LABELS[taskForm.status] || taskForm.status}
              </Pill>
            </div>
            <div className="field">
              <label>Título</label>
              <input className="input" value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} />
            </div>
            <div className="grid-3">
              <div className="field">
                <label>Estado</label>
                <select className="select" value={taskForm.status} onChange={(e) => setTaskForm({ ...taskForm, status: e.target.value })}>
                  {Object.keys(TASK_STATUS_LABELS).map((k) => <option key={k} value={k}>{TASK_STATUS_LABELS[k]}</option>)}
                </select>
              </div>
              {taskForm.status === 'pospuesta' && (
                <div className="muted" style={{ fontSize: 12, gridColumn: 'span 2' }}>
                  Puede reprogramar ahora ajustando "vence" abajo, o dejarla pospuesta y reprogramarla más adelante.
                </div>
              )}
              <div className="field">
                <label>Prioridad</label>
                <select className="select" value={taskForm.priority} onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}>
                  <option value="baja">baja</option>
                  <option value="normal">normal</option>
                  <option value="alta">alta</option>
                  <option value="critica">crítica</option>
                </select>
              </div>
              <div className="field">
                <label>Se repite</label>
                <select className="select" value={taskForm.recurrenceRule} onChange={(e) => setTaskForm({ ...taskForm, recurrenceRule: e.target.value })}>
                  {Object.entries(RECURRENCE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid-3">
              <div className="field">
                <label>Vence</label>
                <input className="input" type="datetime-local" value={taskForm.dueAt} onChange={(e) => setTaskForm({ ...taskForm, dueAt: e.target.value })} />
              </div>
              <div className="field">
                <label>Responsable</label>
                <select className="select" value={taskForm.assigneeId} onChange={(e) => setTaskForm({ ...taskForm, assigneeId: e.target.value })}>
                  <option value="">sin responsable</option>
                  {technicians
                    .filter((t) => t.userId)
                    .map((t) => <option key={t.userId as string} value={t.userId as string}>{t.user?.name || '—'}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label>Notas</label>
              <textarea className="textarea" value={taskForm.notes} onChange={(e) => setTaskForm({ ...taskForm, notes: e.target.value })} />
            </div>
            {taskMeta.relatedEntityType && taskMeta.relatedEntityId && (
              <div className="mb-8">
                Vinculada a {taskMeta.relatedEntityType}:{' '}
                <Link className="link" href={`/${taskMeta.relatedEntityType === 'ticket' ? 'tickets' : 'clientes'}/${taskMeta.relatedEntityId}`}>
                  ver {taskMeta.relatedEntityType}
                </Link>
              </div>
            )}
          </div>
        )}
        <div className="modal-foot flex flex-between">
          {isAppt ? (
            <div className="flex">
              <button className="btn" onClick={createTicket} disabled={busy}>
                crear ticket
              </button>
              <button className="btn btn-danger" onClick={() => deleteItem()}>eliminar</button>
            </div>
          ) : (
            <button className="btn btn-ghost" onClick={onClose}>cancelar</button>
          )}
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'guardando…' : 'guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Pill({ style, children }: { style: string; children: React.ReactNode }) {
  return <span className={`pill ${style}`}>{children}</span>;
}
