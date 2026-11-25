'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Empty, Pill } from './ui';
import {
  PRIORITY_LABELS,
  PRIORITY_PILLS,
  RECURRENCE_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUS_PILLS,
  compareTasksForMyDay,
  formatDay,
  taskDueLabel,
  taskDuePill,
} from '../lib/helpers';
import { ActivityDetailModal, type ModalItem } from './activity-detail';
import { TaskForm } from './task-form';

interface TaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
  recurrenceRule?: string | null;
}

// Sección "Tareas" reutilizable en el detalle de ticket y en la ficha de cliente.
export function TasksSection({
  ticketId,
  customerId,
  defaultAssigneeId = null,
}: {
  ticketId?: string;
  customerId?: string;
  defaultAssigneeId?: string | null;
}) {
  const { hasPerm } = useAuth();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<ModalItem | null>(null);
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const relatedType = ticketId ? 'ticket' : 'customer';
  const relatedId = ticketId || customerId || '';

  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  function flash(message: string) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = setTimeout(() => setNotice(''), 3000);
  }

  function load() {
    api
      .get<TaskRow[]>(
        `/tasks?relatedEntityType=${relatedType}&relatedEntityId=${encodeURIComponent(relatedId)}`,
      )
      .then((items) => {
        const sorted = [...(items || [])].sort((a, b) => {
          const activeA = a.status === 'pendiente' || a.status === 'en_progreso' ? 0 : 1;
          const activeB = b.status === 'pendiente' || b.status === 'en_progreso' ? 0 : 1;
          return activeA - activeB || compareTasksForMyDay(a, b);
        });
        setTasks(sorted);
      })
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [relatedType, relatedId]);

  return (
    <Card title="Tareas" meta={`${tasks.length}`}>
      {notice && <div className="notice mb-8">{notice}</div>}
      <div className="flex-between mb-16" style={{ gap: 8 }}>
        <span className="muted" style={{ fontSize: 13 }}>Pendientes primero</span>
        {hasPerm('calendar:write') && (
          <button className="btn btn-sm" onClick={() => setCreating(true)}>
            + {ticketId ? 'tarea de seguimiento' : 'tarea'}
          </button>
        )}
      </div>
      {loading ? (
        <div className="empty">cargando…</div>
      ) : tasks.length === 0 ? (
        <Empty message="Sin tareas vinculadas" />
      ) : (
        <div className="stack">
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className="task-row"
              onClick={() => setOpen({ kind: 'task', id: task.id })}
            >
              <div className="flex-between" style={{ gap: 8 }}>
                <span style={{ fontWeight: 500 }}>{task.title}</span>
                {task.recurrenceRule && task.recurrenceRule !== 'none' && (
                  <span title={RECURRENCE_LABELS[task.recurrenceRule] || task.recurrenceRule}>↻</span>
                )}
              </div>
              <div className="flex wrap" style={{ marginTop: 4 }}>
                <Pill style={TASK_STATUS_PILLS[task.status] || 'pill-gray'}>
                  {TASK_STATUS_LABELS[task.status] || task.status}
                </Pill>
                <Pill style={PRIORITY_PILLS[task.priority] || 'pill-gray'}>
                  {PRIORITY_LABELS[task.priority] || task.priority}
                </Pill>
                <Pill style={taskDuePill(task.dueAt)}>{taskDueLabel(task.dueAt)}</Pill>
                {task.dueAt && <span className="card-meta">{formatDay(task.dueAt)}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
      {creating && (
        <TaskForm
          defaults={{
            assigneeId: defaultAssigneeId,
            relatedEntityType: relatedType,
            relatedEntityId: relatedId,
          }}
          onClose={() => setCreating(false)}
          onSaved={(task) => {
            setCreating(false);
            load();
            flash(
              task?.assigneeId
                ? `Tarea creada y asignada a ${task.assigneeName || 'otra persona'}`
                : 'Tarea creada',
            );
          }}
        />
      )}
      {open && (
        <ActivityDetailModal
          item={open}
          onClose={() => setOpen(null)}
          onSaved={() => { setOpen(null); flash('Tarea actualizada'); load(); }}
        />
      )}
    </Card>
  );
}
