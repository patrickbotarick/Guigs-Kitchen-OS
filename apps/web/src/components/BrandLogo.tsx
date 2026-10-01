export function BrandLogo({ large = false }: { large?: boolean }) {
  return <span className={large ? 'brand-logo brand-logo-large' : 'brand-logo'}>
    <img src="/logo-guigs.png" alt="Logo oficial da Pizzaria Guig's" />
    <span className="brand-product"><strong>Kitchen OS</strong><small>OPERAÇÃO DA COZINHA</small></span>
  </span>;
}
