import { Link } from 'react-router-dom';
import { useKitchen } from '../useKitchen';
import { BrandLogo } from '../components/BrandLogo';

export function Dashboard() {
  const { orders, apiOnline, realtime } = useKitchen();
  return <div className="page dashboard">
    <section className="hero">
      <BrandLogo large />
      <div className="eyebrow">OPERAÇÃO DA COZINHA · PROTÓTIPO</div>
      <h1>Pedidos claros.<br /><em>Cozinha em movimento.</em></h1>
      <p>Simule pedidos e acompanhe a fila de produção em tempo real.</p>
      <div className="actions"><Link className="button primary" to="/orders/new">Novo pedido de teste <span>↗</span></Link><Link className="button secondary" to="/kitchen">Abrir fila da cozinha</Link></div>
    </section>
    <section className="dashboard-stats" aria-label="Estado do sistema">
      <div className="stat"><span>Pedidos aguardando</span><strong>{orders.filter(order => order.status === 'WAITING_PRODUCTION').length}</strong><small>na fila de produção</small></div>
      <div className="stat"><span>API</span><strong className={apiOnline ? 'good' : 'bad'}>{apiOnline ? 'Online' : 'Indisponível'}</strong><small>serviço local</small></div>
      <div className="stat"><span>Realtime</span><strong className={realtime ? 'good' : 'warn'}>{realtime ? 'Conectado' : 'Reconectando'}</strong><small>atualização automática</small></div>
    </section>
  </div>;
}
