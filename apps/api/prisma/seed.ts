import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });
const prisma = new PrismaClient();

try {
  for (const name of ['Rafael', 'Lucas', 'João']) {
    await prisma.worker.upsert({ where: { name }, update: {}, create: { name } });
  }
  for (const name of ['Calabresa', 'Portuguesa', 'Mussarela', 'Frango com Catupiry']) {
    await prisma.catalogFlavor.upsert({ where: { name }, update: {}, create: { name } });
  }
  for (const name of ['Pequena', 'Média', 'Grande']) {
    await prisma.catalogSize.upsert({ where: { name }, update: {}, create: { name } });
  }
  console.info('Seed concluído: montadores, sabores e tamanhos.');
} finally {
  await prisma.$disconnect();
}
