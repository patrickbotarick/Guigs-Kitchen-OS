import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useOperatorSession } from '../features/kitchen/useOperatorSession';
import { OperationalPopover } from './OperationalPopover';
export const operationalNavigation = [
  { label: 'Cozinha', links: [['Visão geral', '/kitchen'], ['Montagem', '/kitchen/assembly'], ['Forno e Finalização', '/kitchen/finishing']] },
  { label: 'Balcão', links: [['Despacho', '/counter/dispatch']] },
  { label: 'Ferramentas', links: [['Simulador de Pedido', '/orders/new']] },
];
export function OperationalNavigation({ stationActions, upward = false }: { stationActions?: ReactNode; upward?: boolean }) {
  const { session } = useOperatorSession(), { pathname } = useLocation();
  const current = operationalNavigation.flatMap(group => group.links).find(([, path]) => path === pathname)?.[0] ?? (pathname.endsWith('/recovery') ? 'Recuperação' : 'Compatibilidade / Dev');
  return <OperationalPopover label={`Menu operacional: ${current}`} upward={upward} className="op-navigation" trigger={open => <><span>{current}</span><span className="op-menu-label">{open ? '×' : 'Menu'}</span></>}>
    {close => <><nav aria-label="Navegação operacional">{stationActions && <h2>Navegação</h2>}{operationalNavigation.map(group => <section key={group.label}><h2>{group.label}</h2>{group.links.map(([label, path]) => <NavLink key={path} to={path} end onClick={close}>{label}</NavLink>)}{group.label === 'Ferramentas' && session?.role === 'SUPERVISOR' && <NavLink to="/kitchen/assembly/recovery" end onClick={close}>Recuperação</NavLink>}{group.label === 'Ferramentas' && import.meta.env.DEV && <details className="op-compatibility"><summary>Compatibilidade / Dev</summary><NavLink to="/compatibility" onClick={close}>Painel legado</NavLink><NavLink to="/orders/new/legacy" onClick={close}>Formulário legado</NavLink><NavLink to="/kitchen/assembly/dev" onClick={close}>Demonstração de montagem</NavLink></details>}</section>)}</nav>{stationActions && <section className="op-station-settings" aria-label="Configurações da estação"><h2>{pathname === '/kitchen/assembly' ? 'Estação de montagem' : 'Sessão'}</h2>{stationActions}</section>}</>}
  </OperationalPopover>;
}
