import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app/App';
import { AuthProvider } from './context/AuthContext';
import { TenantProvider } from './context/TenantContext';
import { AcademicYearProvider } from './context/AcademicYearContext';
import { ToastProvider } from './components/ui/Toast';
import { ConfirmProvider } from './components/ui/ConfirmDialog';
import { redirectLegacyUrl, routerBasename } from './lib/tenantPath';
import './index.css';

// URL sin colegio (/login?colegio=demo, /students…) → /demo/…; si redirige, no se monta nada.
if (!redirectLegacyUrl()) {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      {/* /demo/students → la app ve "/students": las rutas internas no cambian (lib/tenantPath.js) */}
      <BrowserRouter basename={routerBasename}>
        <AuthProvider>
          <TenantProvider>
            {/* Año escolar global (selector de la barra superior): lo leen todos los módulos. */}
            <AcademicYearProvider>
              <ToastProvider>
                <ConfirmProvider>
                  <App />
                </ConfirmProvider>
              </ToastProvider>
            </AcademicYearProvider>
          </TenantProvider>
        </AuthProvider>
      </BrowserRouter>
    </React.StrictMode>
  );
}
