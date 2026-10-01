import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { NewOrder } from './pages/NewOrder';
import { Kitchen } from './pages/Kitchen';
import { BrandLogo } from './components/BrandLogo';
import './style.css';

function App() {
  const location = useLocation();
  return <div className="app-shell">
    <header className="topbar">
      <Link className="brand" to="/" aria-label="Guig's Kitchen, voltar ao painel"><BrandLogo /></Link>
      <nav aria-label="Navegação principal">
        <Link className={location.pathname === '/' ? 'active' : ''} to="/">Painel</Link>
        <Link className={location.pathname === '/orders/new' ? 'active' : ''} to="/orders/new">Novo pedido</Link>
        <Link className={location.pathname === '/kitchen' ? 'active' : ''} to="/kitchen">Cozinha</Link>
      </nav>
    </header>
    <main><Routes><Route path="/" element={<Dashboard />} /><Route path="/orders/new" element={<NewOrder />} /><Route path="/kitchen" element={<Kitchen />} /></Routes></main>
  </div>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>);
