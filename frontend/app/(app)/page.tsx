'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { Card, PageHeader } from '../../components/ui';

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  if (loading) {
    return <div className="empty">cargando…</div>;
  }

  if (!user) {
    return (
      <div className="empty">
        <Card>
          <PageHeader title="Iniciá sesión para continuar" />
          <button className="btn btn-primary" onClick={() => router.push('/login')}>
            ir al login
          </button>
        </Card>
      </div>
    );
  }

  const isSupervisor = user.role === 'Supervisor' || user.role === 'Administrador';
  router.replace(isSupervisor ? '/dashboard' : '/mi-dia');
  return <div className="empty">redirigiendo…</div>;
}
