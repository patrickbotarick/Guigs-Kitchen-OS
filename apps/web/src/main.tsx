import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { NewOrder } from './pages/NewOrder';
import { LegacyNewOrder } from './pages/LegacyNewOrder';
import { Kitchen } from './pages/Kitchen';
import { BrandLogo } from './components/BrandLogo';
import { AssemblyLayout } from './features/kitchen/useAssembly';
import { KitchenAssemblyPage } from './features/kitchen/pages/KitchenAssemblyPage';
import { KitchenSimulatorPage } from './features/kitchen/pages/KitchenSimulatorPage';
import { KitchenRecoveryPage } from './features/kitchen/pages/KitchenRecoveryPage';
import { ProductionStation } from './features/kitchen/ProductionStation';
import { CounterDispatchPage } from './features/dispatch/CounterDispatchPage';
import './style.css';
import './operational-ui.css';

function App() {
  const location = useLocation();
  const assembly = location.pathname === '/kitchen/assembly' || location.pathname.startsWith('/kitchen/assembly/') || location.pathname === '/kitchen/oven' || location.pathname === '/kitchen/finishing' || location.pathname === '/kitchen/dispatch' || location.pathname === '/counter/dispatch';
  return <div className="app-shell">
    {!assembly && <header className="topbar">
      <Link className="brand" to="/" aria-label="Guig's Kitchen, voltar ao painel"><BrandLogo /></Link>
      <nav aria-label="Navegação principal">
        <span>Balcão</span><Link className={location.pathname === '/' ? 'active' : ''} to="/">Pedidos</Link>
        <Link className={location.pathname === '/orders/new' ? 'active' : ''} to="/orders/new">Simulador</Link><Link to="/counter/dispatch">Despacho / Rotas</Link>
        <span>Cozinha</span><Link className={location.pathname === '/kitchen' ? 'active' : ''} to="/kitchen">Visão geral</Link>
        <Link to="/kitchen/assembly">Montagem</Link>
        <Link to="/kitchen/finishing">Forno e Finalização</Link>
      </nav>
    </header>}
    <main><Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/orders/new" element={<NewOrder />} />
      <Route path="/orders/new/legacy" element={<LegacyNewOrder />} />
      <Route path="/kitchen" element={<Kitchen />} />
      <Route path="/kitchen/oven" element={<Navigate to="/kitchen/finishing" replace />} />
      <Route path="/kitchen/finishing" element={<ProductionStation />} /><Route path="/kitchen/dispatch" element={<Navigate to="/counter/dispatch" replace />} /><Route path="/counter/dispatch" element={<CounterDispatchPage />} />
      <Route path="/kitchen/assembly" element={<AssemblyLayout />}>
        <Route index element={<KitchenAssemblyPage />} />
        <Route path="recovery" element={<KitchenRecoveryPage />} />
        {import.meta.env.DEV && <Route path="dev" element={<KitchenSimulatorPage />} />}
      </Route>
    </Routes></main>
  </div>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>);
