import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { PrismaClient } from '@prisma/client';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env') });
const prisma = new PrismaClient(), questions = createInterface({ input: process.stdin, output: process.stdout });
try {
  const deviceKey = (await questions.question('UUID do terminal (mostrado na tela de PIN): ')).trim().toLowerCase();
  const terminal = await prisma.workstation.findUnique({ where: { deviceKey } });
  if (!terminal) throw new Error('Terminal ainda não registrado; faça primeiro um login válido nesse tablet.');
  const name = (await questions.question('Novo nome do terminal: ')).trim();
  if (!name || name.length > 80) throw new Error('Nome deve ter entre 1 e 80 caracteres.');
  await prisma.workstation.update({ where: { id: terminal.id }, data: { name } });
  console.info(`Terminal atualizado: ${name}.`);
} catch (error) { console.error(error instanceof Error ? error.message : 'Falha na configuração.'); process.exitCode = 1; }
finally { questions.close(); await prisma.$disconnect(); }
