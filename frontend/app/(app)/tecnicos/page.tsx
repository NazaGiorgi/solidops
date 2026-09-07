'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { Shell } from '../shell';
import { PageHeader, Card, Empty, Pill } from '../../../components/ui';
import { TECH_STATUS_PILLS, LEVEL_LABELS } from '../../../lib/helpers';

interface Technician {
  id: string;
  level: string;
  status: string;
  specialties: string[];
  whatsappPhone?: string | null;
  user?: { name?: string };
}

export default function TechniciansPage() {
  const [techs, setTechs] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Technician[]>('/technicians')
      .then(setTechs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const setStatus = async (id: string, status: string) => {
    await api.patch(`/technicians/${id}/presence`, { status });
    setTechs((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
  };

  const savePhone = async (id: string, raw: string) => {
    const digits = raw.replace(/\D/g, '') || null;
    const tech = techs.find((t) => t.id === id);
    if (tech?.whatsappPhone === digits) return; // sin cambios

    try {
      await api.patch(`/technicians/${id}`, { whatsappPhone: digits });
      setTechs((prev) => prev.map((t) => (t.id === id ? { ...t, whatsappPhone: digits } : t)));
      setSaved(id);
      setTimeout(() => setSaved((cur) => (cur === id ? null : cur)), 1800);
    } catch {
      // fallo silencioso — el admin puede reintentar
    }
  };

  return (
    <Shell>
      <PageHeader title="Técnicos" subtitle="Perfiles y disponibilidad del equipo" />
      {loading ? (
        <div className="empty">cargando…</div>
      ) : techs.length === 0 ? (
        <Empty message="Sin técnicos" />
      ) : (
        <div className="grid-auto">
          {techs.map((t) => (
            <Card key={t.id} title={t.user?.name || 'sin nombre'}>
              <div className="flex wrap mb-8">
                <Pill style={TECH_STATUS_PILLS[t.status] || 'pill-gray'}>{t.status}</Pill>
                <Pill style="pill-blue">{LEVEL_LABELS[t.level] || t.level}</Pill>
              </div>
              {t.specialties?.length > 0 && (
                <div className="flex wrap">
                  {t.specialties.map((s) => (
                    <Pill key={s} style="pill-gray">
                      {s}
                    </Pill>
                  ))}
                </div>
              )}
              <div className="field mt-16" style={{ marginTop: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-soft)' }}>
                  WhatsApp
                </label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    className="input"
                    defaultValue={t.whatsappPhone || ''}
                    placeholder="5491172450095"
                    style={{ width: '100%', fontSize: 13 }}
                    onBlur={(e) => savePhone(t.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                  />
                  {saved === t.id && (
                    <span style={{ fontSize: 11, color: 'var(--green, #22c55e)', whiteSpace: 'nowrap' }}>
                      ✓ guardado
                    </span>
                  )}
                </div>
              </div>
              <div className="flex wrap mt-16">
                <button className="btn btn-sm" onClick={() => setStatus(t.id, 'disponible')}>
                  disponible
                </button>
                <button className="btn btn-sm" onClick={() => setStatus(t.id, 'ocupado')}>
                  ocupado
                </button>
                <button className="btn btn-sm" onClick={() => setStatus(t.id, 'fuera_de_horario')}>
                  fuera de horario
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Shell>
  );
}
