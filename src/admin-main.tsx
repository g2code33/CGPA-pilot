import React from 'react';
import ReactDOM from 'react-dom/client';
import { AdminProvider } from './admin/adminStore';
import { AdminApp } from './admin/AdminApp';
import { ErrorBoundary } from './ErrorBoundary';
import { AppDialogProvider } from './components/appDialog';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AdminProvider>
        <AppDialogProvider>
          <AdminApp />
        </AppDialogProvider>
      </AdminProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
