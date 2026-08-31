import React from 'react';
import ReactDOM from 'react-dom/client';
import { AdminProvider } from './admin/adminStore';
import { AdminApp } from './admin/AdminApp';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AdminProvider>
      <AdminApp />
    </AdminProvider>
  </React.StrictMode>
);
