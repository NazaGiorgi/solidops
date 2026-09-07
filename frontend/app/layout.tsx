import './globals.css';
import './components.css';
import './agenda.css';
import { AuthProvider } from '../lib/auth';
import { ToastProvider, ToastViewport } from '../components/toast';

export const metadata = {
  title: 'SolidOps',
  description: 'Plataforma de operaciones IT — tickets, agenda y clientes',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <AuthProvider>
          <ToastProvider>
            {children}
            <ToastViewport />
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}