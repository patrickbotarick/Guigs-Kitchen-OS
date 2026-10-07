import { useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useOperatorSession } from '../features/kitchen/useOperatorSession';
import { AssemblyIcon } from '../features/kitchen/components/AssemblyIcons';

export const operationalNavigation = [
  { label: 'Cozinha', links: [['Visão geral', '/kitchen'], ['Montagem', '/kitchen/assembly'], ['Forno e Finalização', '/kitchen/finishing']] },
  { label: 'Balcão', links: [['Despacho', '/counter/dispatch']] },
  { label: 'Ferramentas', links: [['Simulador de Pedido', '/orders/new']] },
];
export function OperationalNavigation() {
  const { session } = useOperatorSession(), { pathname } = useLocation();
  const menu = useRef<HTMLDetailsElement>(null);
  const current = operationalNavigation.flatMap(group => group.links).find(([, path]) => path === pathname)?.[0] ?? (pathname.endsWith('/recovery') ? 'Recuperação' : 'Compatibilidade / Dev');
  function close() { if (menu.current) menu.current.open = false; }
  return <details className="op-navigation" ref={menu}><summary><AssemblyIcon name="queue" /><span>{current}</span><span className="op-menu-label">Menu</span></summary><nav aria-label="Navegação operacional">{operationalNavigation.map(group => <section key={group.label}><h2>{group.label}</h2>{group.links.map(([label, path]) => <NavLink key={path} to={path} end onClick={close}>{label}</NavLink>)}{group.label === 'Ferramentas' && session?.role === 'SUPERVISOR' && <NavLink to="/kitchen/assembly/recovery" end onClick={close}>Recuperação</NavLink>}{group.label === 'Ferramentas' && import.meta.env.DEV && <details className="op-compatibility"><summary>Compatibilidade / Dev</summary><NavLink to="/compatibility" onClick={close}>Painel legado</NavLink><NavLink to="/orders/new/legacy" onClick={close}>Formulário legado</NavLink><NavLink to="/kitchen/assembly/dev" onClick={close}>Demonstração de montagem</NavLink></details>}</section>)}</nav></details>;
}
