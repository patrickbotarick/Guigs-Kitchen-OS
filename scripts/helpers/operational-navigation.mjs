export async function openOperationalMenu(page) {
  const trigger = page.locator('.op-navigation > .op-trigger');
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
}
export async function closeOperationalMenu(page) {
  const trigger = page.locator('.op-navigation > .op-trigger');
  if (await trigger.getAttribute('aria-expanded') === 'true') await trigger.click();
}
export async function selectAssemblyFilter(page, label) {
  await closeOperationalMenu(page);
  await page.getByRole('button', { name: 'Filtrar pizzas', exact: true }).click();
  await page.getByRole('button', { name: label, exact: true }).click();
}
