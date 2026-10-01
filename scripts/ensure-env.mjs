import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const local = resolve('.env');
if (!existsSync(local)) {
  copyFileSync(resolve('.env.example'), local);
  console.info('Configuração local criada em .env');
}
