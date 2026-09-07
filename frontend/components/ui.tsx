import { ReactNode } from 'react';

export function Pill({ style, children }: { style: string; children: ReactNode }) {
  return <span className={`pill ${style}`}>{children}</span>;
}

export function Card({
  title,
  meta,
  children,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="card">
      {title && <h3 className="card-title">{title}</h3>}
      {meta && <div className="card-meta">{meta}</div>}
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex-between wrap mb-16">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {action && <div className="flex">{action}</div>}
    </div>
  );
}

export function Empty({ message }: { message?: string }) {
  return <div className="empty">{message ?? 'No hay nada para mostrar todavía.'}</div>;
}
