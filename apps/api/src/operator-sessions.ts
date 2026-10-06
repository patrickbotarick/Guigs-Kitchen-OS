import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { operatorLoginSchema, operatorPinSchema, operatorSessionSchema, type OperatorLoginInput } from '@guigs/shared';

export class OperationalAuthError extends Error {
  constructor() { super('Sessão operacional inválida ou encerrada. Identifique-se novamente.'); }
}
export class PinLoginError extends Error {
  constructor() { super('PIN inválido ou terminal indisponível.'); }
}
export class SessionResponsibilityConflictError extends Error {
  constructor() { super('Há pizzas sob sua responsabilidade. Pause e libere as pizzas antes de trocar ou encerrar a sessão.'); }
}
export class LoginRateLimitError extends Error {
  constructor(public readonly retryAfter: number) { super('Muitas tentativas. Aguarde antes de tentar novamente.'); }
}
export type SessionCredentials = { token: string; deviceKey: string };
type SessionDatabase = Pick<Prisma.TransactionClient, 'operatorSession'>;
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
function derive(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((done, reject) => scrypt(pin, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, hash) => error ? reject(error) : done(hash)));
}
export async function hashOperatorPin(pin: string) {
  operatorPinSchema.parse(pin); const salt = randomBytes(16), hash = await derive(pin, salt);
  return `scrypt$16384$8$1$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export async function verifyOperatorPin(pin: string, encoded: string) {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts.slice(0, 4).join('$') !== 'scrypt$16384$8$1' || !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5])) return false;
  return timingSafeEqual(await derive(pin, Buffer.from(parts[4], 'hex')), Buffer.from(parts[5], 'hex'));
}
async function transactionRetry<T>(prisma: PrismaClient, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(run, { timeout: 20000, maxWait: 5000 }); }
    catch (error) {
      if (attempt >= 3 || !(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2002', 'P2034', 'P2028', 'P1008'].includes(error.code)) throw error;
      await new Promise(done => setTimeout(done, 50 * (attempt + 1)));
    }
  }
}

// Administrative configuration only: no public registration/list-by-PIN endpoint.
export async function configureOperator(prisma: PrismaClient, input: { name: string; pin: string; active?: boolean }) {
  const name = input.name.trim(); if (!name || name.length > 80) throw new Error('Nome deve ter entre 1 e 80 caracteres.');
  operatorPinSchema.parse(input.pin); const pinHash = await hashOperatorPin(input.pin);
  return transactionRetry(prisma, async tx => {
    const operators = await tx.operator.findMany();
    for (const operator of operators) if (operator.name !== name && await verifyOperatorPin(input.pin, operator.pinHash)) throw new Error('PIN já utilizado; escolha outro.');
    const operator = await tx.operator.upsert({ where: { name }, create: { name, pinHash, active: input.active ?? true }, update: { pinHash, active: input.active ?? true } });
    // PIN rotation/deactivation revokes prior credentials, but preserves historical sessions.
    await tx.operatorSession.updateMany({ where: { operatorId: operator.id, active: true }, data: { active: false, endedAt: new Date() } });
    return { id: operator.id, name: operator.name, active: operator.active };
  });
}

export class OperatorSessionService {
  private attempts = new Map<string, { count: number; until: number }>();
  private loginBusy = 0;
  constructor(private readonly prisma: PrismaClient, private readonly lifetimeMs = 12 * 60 * 60 * 1000) {
    if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0) throw new Error('Duração da sessão inválida.');
  }
  private limit(deviceKey: string, networkKey: string) {
    const now = Date.now();
    for (const [key, entry] of this.attempts) if (entry.until <= now) this.attempts.delete(key);
    if (this.attempts.size > 2000) throw new LoginRateLimitError(60);
    const scopes = [{ key: `device:${deviceKey}`, max: 5, window: 5 * 60_000 }, { key: `network:${networkKey}`, max: 30, window: 60_000 }];
    for (const scope of scopes) {
      const entry = this.attempts.get(scope.key);
      if (entry && entry.count >= scope.max) throw new LoginRateLimitError(Math.max(1, Math.ceil((entry.until - now) / 1000)));
    }
    for (const scope of scopes) { const entry = this.attempts.get(scope.key); this.attempts.set(scope.key, { count: (entry?.count ?? 0) + 1, until: entry?.until ?? now + scope.window }); }
  }
  async signIn(payload: OperatorLoginInput, networkKey = 'local') {
    const input = operatorLoginSchema.parse(payload), deviceKey = input.workstationDeviceKey.toLowerCase();
    this.limit(deviceKey, networkKey);
    if (this.loginBusy >= 2) throw new LoginRateLimitError(2);
    this.loginBusy++;
    try {
      const operators = await this.prisma.operator.findMany({ where: { active: true } });
      let matched: typeof operators[number] | undefined;
      let matches = 0;
      // Compare every active hash: never reveal a name or early-match position.
      for (const operator of operators) if (await verifyOperatorPin(input.pin, operator.pinHash)) { matched = operator; matches++; }
      if (!operators.length) await derive(input.pin, Buffer.alloc(16));
      if (!matched || matches !== 1) throw new PinLoginError();
      const operatorId = matched.id, token = randomBytes(32).toString('hex');
      const session = await transactionRetry(this.prisma, async tx => {
        const operator = await tx.operator.findUniqueOrThrow({ where: { id: operatorId } });
        if (!operator.active || operator.pinHash !== matched!.pinHash) throw new PinLoginError();
        const workstation = await tx.workstation.upsert({ where: { deviceKey }, create: { deviceKey, name: `Tablet Cozinha ${deviceKey.slice(0, 8)}` }, update: { updatedAt: new Date() } });
        if (!workstation.active) throw new PinLoginError();
        const activeClaims = await tx.pizzaItem.count({ where: { assignedWorkstationId: workstation.id, assignedOperatorId: { not: operatorId }, state: { in: ['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED'] } } });
        if (activeClaims) throw new SessionResponsibilityConflictError();
        const now = new Date();
        await tx.operatorSession.updateMany({ where: { workstationId: workstation.id, active: true }, data: { active: false, endedAt: now } });
        const created = await tx.operatorSession.create({ data: { operatorId, workstationId: workstation.id, tokenHash: tokenHash(token), startedAt: now, expiresAt: new Date(now.getTime() + this.lifetimeMs) }, include: { operator: true, workstation: true } });
        return this.view(created);
      });
      this.attempts.delete(`device:${deviceKey}`);
      return { session, token };
    } finally { this.loginBusy--; }
  }
  private view(session: { id: string; operatorId: string; workstationId: string; startedAt: Date; expiresAt: Date; operator: { name: string }; workstation: { name: string } }) {
    return operatorSessionSchema.parse({ sessionId: session.id, operatorId: session.operatorId, operatorName: session.operator.name,
      workstationId: session.workstationId, workstationName: session.workstation.name, startedAt: session.startedAt.toISOString(), expiresAt: session.expiresAt.toISOString() });
  }
  async validate(credentials: SessionCredentials | undefined, db: SessionDatabase = this.prisma) {
    if (!credentials || !/^[a-f0-9]{64}$/.test(credentials.token) || !credentials.deviceKey) throw new OperationalAuthError();
    const session = await db.operatorSession.findUnique({ where: { tokenHash: tokenHash(credentials.token) }, include: { operator: true, workstation: true } });
    if (!session || !session.active || session.endedAt || session.expiresAt.getTime() <= Date.now() || !session.operator.active || !session.workstation.active || session.workstation.deviceKey !== credentials.deviceKey.toLowerCase()) throw new OperationalAuthError();
    return { sessionId: session.id, operatorId: session.operatorId, workstationId: session.workstationId, view: this.view(session) };
  }
  async current(credentials: SessionCredentials) { return (await this.validate(credentials)).view; }
  async end(credentials: SessionCredentials) {
    return transactionRetry(this.prisma, async tx => {
      const session = await this.validate(credentials, tx);
      if (await tx.pizzaItem.count({ where: { assignedOperatorId: session.operatorId, state: { in: ['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED'] } } })) throw new SessionResponsibilityConflictError();
      await tx.operatorSession.update({ where: { id: session.sessionId }, data: { active: false, endedAt: new Date() } });
    });
  }
}
