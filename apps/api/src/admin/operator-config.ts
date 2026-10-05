import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { PrismaClient } from '@prisma/client';
import { configureOperator } from '../operator-sessions.js';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env') });
const prisma = new PrismaClient();
function maskedPin(): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error('Execute em um terminal interativo para digitar o PIN sem exposição.');
  process.stdout.write('PIN (4 a 8 números): '); process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((done, reject) => {
    let value = '';
    const cleanup = () => { process.stdin.off('data', receive); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    function receive(chunk: Buffer) {
      for (const character of chunk.toString()) {
        if (character === '\u0003') { cleanup(); reject(new Error('Cadastro cancelado.')); return; }
        if (character === '\r' || character === '\n') { cleanup(); done(value); return; }
        if (character === '\u007f' || character === '\b') { if (value) { value = value.slice(0, -1); process.stdout.write('\b \b'); } }
        else if (/\d/.test(character) && value.length < 8) { value += character; process.stdout.write('•'); }
      }
    }
    process.stdin.on('data', receive);
  });
}
try {
  const questions = createInterface({ input: process.stdin, output: process.stdout });
  const name = await questions.question('Nome do montador (novo ou existente): '); questions.close();
  const pin = await maskedPin();
  const operator = await configureOperator(prisma, { name, pin, active: !process.argv.includes('--inactive') });
  console.info(`Operador ${operator.name}: ${operator.active ? 'ativo' : 'inativo'}. Sessões anteriores encerradas.`);
} catch (error) { console.error(error instanceof Error ? error.message : 'Falha no cadastro.'); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
