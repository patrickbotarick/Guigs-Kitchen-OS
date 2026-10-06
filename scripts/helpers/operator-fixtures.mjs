import { randomBytes, scryptSync } from 'node:crypto';

// Disposable databases only. Never invoked by the store's production seed.
export const operatorFixtures = [{ name: 'João fixture', pin: '4826' }, { name: 'Carlos fixture', pin: '5937' }, { name: 'Pedro fixture', pin: '6048' }];
export async function seedOperatorFixtures(prisma) {
  for (const operator of operatorFixtures) {
    const salt = randomBytes(16), hash = scryptSync(operator.pin, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    await prisma.operator.create({ data: { name: operator.name, pinHash: `scrypt$16384$8$1$${salt.toString('hex')}$${hash.toString('hex')}` } });
  }
}
export async function loginPin(page, pin = operatorFixtures[0].pin) {
  await page.getByRole('heading', { name: 'Identifique-se', exact: true }).waitFor();
  for (const digit of pin) await page.getByRole('button', { name: digit, exact: true }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.getByLabel('Identidade operacional', { exact: true }).waitFor();
}
