'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { Shell } from '../../shell';
import { PageHeader, Card } from '../../../../components/ui';
import { ErrorNotice } from '../../../../components/error-notice';

interface Settings {
  id: string;
  companyName: string;
  businessHours: Record<string, Array<{ start: string; end: string }>>;
  slaFirstResponseMinutes: number;
  slaResolutionHours: number;
  contactEmail: string | null;
  emailAutoResponseEnabled: boolean;
  emailSender: string | null;
}

const WEEKDAYS: Array<{ key: string; label: string }> = [
  { key: 'mon', label: 'Lunes' },
  { key: 'tue', label: 'Martes' },
  { key: 'wed', label: 'Miércoles' },
  { key: 'thu', label: 'Jueves' },
  { key: 'fri', label: 'Viernes' },
  { key: 'sat', label: 'Sábado' },
  { key: 'sun', label: 'Domingo' },
];

const DEFAULT_DAY = { start: '09:00', end: '18:00' };

export default function AdminConfigPage() {
  const [company, setCompany] = useState('');
  const [contact, setContact] = useState('');
  const [firstResp, setFirstResp] = useState(60);
  const [resHours, setResHours] = useState(8);
  const [hours, setHours] = useState<Record<string, Array<{ start: string; end: string }>>>({});
  const [autoResp, setAutoResp] = useState(false);
  const [senderEmail, setSenderEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [autoSaved, setAutoSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<Settings>('/admin/settings')
      .then((s) => {
        setCompany(s.companyName);
        setContact(s.contactEmail || '');
        setFirstResp(s.slaFirstResponseMinutes);
        setResHours(s.slaResolutionHours);
        setHours(s.businessHours || {});
        setAutoResp(s.emailAutoResponseEnabled === true);
        setSenderEmail(s.emailSender || '');
      })
      .catch(() => {});
  }, []);

  function dayOn(key: string) {
    return hours[key]?.length ? true : false;
  }
  function toggleDay(key: string) {
    setHours((prev) => {
      const cur = { ...prev };
      if (cur[key]?.length) delete cur[key];
      else cur[key] = [{ ...DEFAULT_DAY }];
      return cur;
    });
  }
  function setHour(key: string, idx: number, field: 'start' | 'end', val: string) {
    setHours((prev) => {
      const cur = { ...prev };
      const list = (cur[key] || []).map((iv) => ({ ...iv }));
      if (!list[idx]) list[idx] = { ...DEFAULT_DAY };
      list[idx][field] = val;
      cur[key] = list;
      return cur;
    });
  }

  // Auto-save del toggle de respuestas automáticas: al tildar/des-tildar, guarda
  // INMEDIATAMENTE (no depende del botón "Guardar configuración"). Envía SOLO el
  // toggle (el backend hace actualización parcial); así no compite con el
  // formulario y nunca puede ser pisado con un valor viejo de otro campo.
  function toggleAutoResp(value: boolean) {
    setAutoResp(value);
    setAutoSaved(false);
    api
      .put<Settings>('/admin/settings', { emailAutoResponseEnabled: value })
      .then(() => {
        setAutoSaved(true);
        setTimeout(() => setAutoSaved(false), 3000);
      })
      .catch((e) => setError((e as Error).message));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // Nota: el toggle emailAutoResponseEnabled se guarda SOLO desde
      // toggleAutoResp (auto-save). No se incluye acá para que el formulario
      // no pueda sobrescribirlo con un valor viejo → el toggle nunca se resetea.
      await api.put('/admin/settings', {
        companyName: company,
        contactEmail: contact || null,
        slaFirstResponseMinutes: Number(firstResp),
        slaResolutionHours: Number(resHours),
        businessHours: hours,
        emailSender: senderEmail || null,
      });
      setMsg('Configuración guardada — se aplica de inmediato');
      setTimeout(() => setMsg(''), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <PageHeader title="Administración · Configuración" subtitle="Datos generales y valores por defecto del sistema" />
      {msg && <div className="notice">{msg}</div>}
      {error && <ErrorNotice message={error} onDismiss={() => setError('')} />}

      <form onSubmit={save}>
        <Card title="Datos generales">
          <div className="grid-3">
            <div className="field">
              <label>Nombre de la empresa</label>
              <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
            <div className="field">
              <label>Email de contacto / remitente</label>
              <input className="input" type="email" value={contact} onChange={(e) => setContact(e.target.value)} />
            </div>
          </div>
        </Card>

        <Card title="Respuestas automáticas por email">
          <div className="field" style={{ marginBottom: 10 }}>
            <label className="flex" style={{ gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={autoResp} onChange={(e) => toggleAutoResp(e.target.checked)} />
              <div>
                <strong>Envíar confirmación al cliente por cada ticket nuevo</strong>
                {autoSaved && (
                  <strong style={{ color: 'var(--success, #16a34a)', marginLeft: 8 }}>✓ Guardado</strong>
                )}
                <div className="card-meta" style={{ maxWidth: 560 }}>
                  Apagado (recomendado mientras convive con Zammad): el correo entrante crea el ticket pero
                  <em> no se envía ninguna respuesta al cliente</em>. Encendido: al crear un ticket desde un
                  correo entrante, se envía al remitente la plantilla «Recibimos tu solicitud — Ticket #N».
                  <strong> Ojo:</strong> con esto encendido, cada correo entrante dispara la respuesta automática.
                </div>
              </div>
            </label>
          </div>
          <div className="grid-3">
            <div className="field">
              <label>Remitente para correos al cliente</label>
              <input className="input" type="email" value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} placeholder="opcional" />
            </div>
          </div>
        </Card>

        <Card title="SLA por defecto (clientes sin contrato)">
          <div className="grid-3">
            <div className="field">
              <label>Primera respuesta (minutos)</label>
              <input className="input" type="number" min={1} value={firstResp} onChange={(e) => setFirstResp(Number(e.target.value))} />
            </div>
            <div className="field">
              <label>Resolución (horas)</label>
              <input className="input" type="number" min={1} value={resHours} onChange={(e) => setResHours(Number(e.target.value))} />
            </div>
          </div>
        </Card>

        <Card title="Horario laboral por defecto">
          <div className="grid-4">
            {WEEKDAYS.map((d) => {
              const on = dayOn(d.key);
              return (
                <div key={d.key} className="field">
                  <label className="flex" style={{ gap: 6, alignItems: 'center' }}>
                    <input type="checkbox" checked={on} onChange={() => toggleDay(d.key)} />
                    {d.label}
                  </label>
                  {on && (
                    <div className="flex" style={{ gap: 6, marginTop: 4 }}>
                      <input
                        className="input"
                        type="time"
                        value={hours[d.key]?.[0]?.start || '09:00'}
                        onChange={(e) => setHour(d.key, 0, 'start', e.target.value)}
                      />
                      <span>–</span>
                      <input
                        className="input"
                        type="time"
                        value={hours[d.key]?.[0]?.end || '18:00'}
                        onChange={(e) => setHour(d.key, 0, 'end', e.target.value)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Se usa para calcular el SLA de tickets sin contrato. Desmarcar todo = 24/7.
          </div>
        </Card>

        <div className="flex" style={{ position: 'sticky', bottom: 12, zIndex: 5, background: 'var(--bg, #fff)', padding: '10px 0', borderTop: '1px solid var(--border)', marginTop: 10 }}>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar configuración'}
          </button>
          <span className="muted" style={{ marginLeft: 10, fontSize: 12 }}>
            El toggle de «respuestas automáticas» se guarda automáticamente; el resto de campos se guarda con este botón.
          </span>
        </div>
      </form>
    </Shell>
  );
}
