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
import { OperationalNavigation } from './components/OperationalNavigation';
import { OperatorSessionProvider } from './features/kitchen/OperatorSessionProvider';
import './style.css';
import './operational-ui.css';

function App() {
  const location = useLocation();
  const operational = location.pathname === '/kitchen' || location.pathname === '/orders/new' || location.pathname === '/kitchen/assembly' || location.pathname.startsWith('/kitchen/assembly/') || location.pathname === '/kitchen/oven' || location.pathname === '/kitchen/finishing' || location.pathname === '/kitchen/dispatch' || location.pathname === '/counter/dispatch';
  return <div className="app-shell">
    {!operational && <header className="topbar">
      <Link className="brand" to="/kitchen" aria-label="Guig's Kitchen, visão geral"><BrandLogo /></Link>
      <OperationalNavigation />
    </header>}
    <main><Routes>
      <Route path="/" element={<Navigate to="/kitchen" replace />} />
      <Route path="/compatibility" element={<><p className="legacy-banner">Compatibilidade / Dev · dados do fluxo legado. <Link to="/counter/dispatch">Voltar ao Despacho</Link></p><Dashboard /></>} />
      <Route path="/orders/new" element={<NewOrder />} />
      <Route path="/orders/new/legacy" element={<><p className="legacy-banner">Compatibilidade / Dev · entrada de pedidos legados. <Link to="/orders/new">Voltar ao Simulador de Pedido</Link></p><LegacyNewOrder /></>} />
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

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><OperatorSessionProvider><App /></OperatorSessionProvider></BrowserRouter></React.StrictMode>);
