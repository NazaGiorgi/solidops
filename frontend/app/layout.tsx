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
    <html lang="es" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var k='solidops_theme';var v=localStorage.getItem(k);var t=(v==='dark'||v==='light')?v:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
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