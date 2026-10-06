import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { deriveOrderProductionState, isLogisticsOrderStatus, pizzaCommandResultSchema, supervisorRecoverySchema, type SupervisorRecoveryInput } from '@guigs/shared';
import { loadCompatibleOrder } from './kitchen-data.js';
import { PizzaCommandConflictError, PizzaCommandNotFoundError } from './pizza-commands.js';
import { OperatorSessionService, transactionRetry, type SessionCredentials } from './operator-sessions.js';
import { sessionPresence } from './presence-policy.js';

export class SupervisorPermissionError extends Error { constructor() { super('Esta operação exige uma sessão de supervisor online.'); } }
export class SupervisorRecoveryService {
  constructor(private readonly prisma: PrismaClient, private readonly sessions = new OperatorSessionService(prisma)) {}
  private async authorize(credentials: SessionCredentials, tx?: Prisma.TransactionClient) {
    const actor = await this.sessions.validate(credentials, tx);
    if (actor.view.role !== 'SUPERVISOR' || actor.view.presenceStatus !== 'ONLINE') throw new SupervisorPermissionError();
    return actor;
  }
  async targets(credentials: SessionCredentials) {
    await this.authorize(credentials);
    const now = new Date();
    const sessions = await this.prisma.operatorSession.findMany({ where: { active: true, endedAt: null, expiresAt: { gt: now }, available: true, operator: { active: true }, workstation: { active: true } }, include: { operator: true, workstation: true }, orderBy: { startedAt: 'desc' } });
    const seen = new Set<string>();
    return sessions.filter(session => {
      if (sessionPresence(session, now, this.sessions.policy) !== 'ONLINE' || seen.has(session.operatorId)) return false;
      seen.add(session.operatorId); return true;
    }).map(session => ({ sessionId: session.id, operatorId: session.operatorId, operatorName: session.operator.name, workstationName: session.workstation.name }));
  }
  async execute(orderId: string, pizzaId: string, payload: SupervisorRecoveryInput, credentials: SessionCredentials) {
    const actor = await this.authorize(credentials), input = supervisorRecoverySchema.parse(payload);
    const { clientCommandId, ...intent } = input;
    const hash = createHash('sha256').update(JSON.stringify({ orderId, pizzaId, ...intent, actorSessionId: actor.sessionId })).digest('hex');
    const replay = (receipt: { payloadHash: string; responseSnapshot: Prisma.JsonValue }) => {
      if (receipt.payloadHash !== hash) throw new PizzaCommandConflictError('Identificador de recuperação já utilizado com outro conteúdo.');
      return pizzaCommandResultSchema.parse({ ...(receipt.responseSnapshot as object), replayed: true });
    };
    const previous = await this.prisma.pizzaCommandReceipt.findUnique({ where: { clientCommandId } });
    if (previous) return replay(previous);
    return transactionRetry(this.prisma, async tx => {
      const actor = await this.authorize(credentials, tx);
      const previous = await tx.pizzaCommandReceipt.findUnique({ where: { clientCommandId } });
      if (previous) return replay(previous);
      const order = await tx.order.findUnique({ where: { id: orderId } }), pizza = await tx.pizzaItem.findUnique({ where: { id: pizzaId } });
      if (!order || order.schemaVersion !== 2 || !pizza || pizza.orderId !== orderId) throw new PizzaCommandNotFoundError('Pizza não encontrada neste pedido v2.');
      if (isLogisticsOrderStatus(order.status) || order.status === 'CANCELLED' || !pizza.assignedOperatorId || pizza.version !== input.expectedVersion || pizza.state !== input.expectedState || !['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED'].includes(pizza.state)) throw new PizzaCommandConflictError('Reserva ou estado atualizado. Recarregue os dados.');
      const pausing = input.command === 'SUPERVISOR_PAUSE', releasing = input.command === 'SUPERVISOR_RELEASE';
      if (pausing ? pizza.state !== 'ASSEMBLING' : pizza.state === 'ASSEMBLING') throw new PizzaCommandConflictError('Pause explicitamente a montagem antes de recuperar ou reatribuir.');
      const now = new Date();
      const target = input.targetSessionId ? await tx.operatorSession.findUnique({ where: { id: input.targetSessionId }, include: { operator: true, workstation: true } }) : null;
      if (input.command === 'SUPERVISOR_REASSIGN' && (!target || !target.available || sessionPresence(target, now, this.sessions.policy) !== 'ONLINE' || target.operatorId === pizza.assignedOperatorId)) throw new PizzaCommandConflictError('Destino deve ser outro operador disponível, com sessão e presença válidas.');
      const toState = pausing ? 'ASSEMBLY_PAUSED' : pizza.state;
      const changed = await tx.pizzaItem.updateMany({ where: { id: pizzaId, orderId, state: input.expectedState, version: input.expectedVersion, assignedOperatorId: pizza.assignedOperatorId }, data: {
        state: toState, version: { increment: 1 }, ...(pausing ? { pausedAt: now } : {}),
        ...(releasing ? { assignedOperatorId: null, assignedWorkstationId: null, assignedSessionId: null, assignedAt: null, releasedAt: now } : {}),
        ...(target ? { assignedOperatorId: target.operatorId, assignedWorkstationId: target.workstationId, assignedSessionId: target.id, assignedAt: now } : {}),
      } });
      if (changed.count !== 1) throw new PizzaCommandConflictError('Pizza atualizada em outro dispositivo.');
      await tx.pizzaProductionHistory.create({ data: { pizzaId, eventType: pausing ? 'SUPERVISOR_PAUSED' : releasing ? 'SUPERVISOR_RELEASED' : 'SUPERVISOR_REASSIGNED',
        fromState: pizza.state, toState, changedAt: now, actorType: 'ADMIN', actorId: actor.operatorId, operatorId: actor.operatorId,
        workstationId: actor.workstationId, operatorSessionId: actor.sessionId, commandId: clientCommandId, itemVersion: pizza.version + 1, reason: input.reason,
        metadata: { previousOperatorId: pizza.assignedOperatorId, previousWorkstationId: pizza.assignedWorkstationId, previousSessionId: pizza.assignedSessionId,
          newOperatorId: target?.operatorId ?? (pausing ? pizza.assignedOperatorId : null), newWorkstationId: target?.workstationId ?? (pausing ? pizza.assignedWorkstationId : null), newSessionId: target?.id ?? (pausing ? pizza.assignedSessionId : null) },
      } });
      const pizzas = await tx.pizzaItem.findMany({ where: { orderId }, select: { state: true } }), extras = await tx.extraItem.findMany({ where: { orderId }, select: { state: true, quantity: true, checkedQuantity: true } });
      const status = deriveOrderProductionState({ pizzas: pizzas.map(pizza => pizza.state), extras, packingConfirmed: Boolean(order.packingFinishedAt && order.packingFinishedBy) });
      const changedOrder = await tx.order.updateMany({ where: { id: orderId, version: order.version }, data: { status, version: { increment: 1 } } });
      if (changedOrder.count !== 1) throw new PizzaCommandConflictError('Pedido atualizado em outro dispositivo.');
      if (status !== order.status) await tx.orderStatusHistory.create({ data: { orderId, fromStatus: order.status, toStatus: status, changedAt: now, actorType: 'ADMIN', actorId: actor.operatorId, metadata: JSON.stringify({ command: input.command, clientCommandId, pizzaId, reason: input.reason }) } });
      const read = await loadCompatibleOrder(tx, orderId);
      if (!read || read.legacy) throw new Error('Falha ao ler recuperação.');
      const result = pizzaCommandResultSchema.parse({ order: read.order, pizzaId, clientCommandId, replayed: false });
      await tx.pizzaCommandReceipt.create({ data: { clientCommandId, payloadHash: hash, orderId, pizzaId, operatorSessionId: actor.sessionId, responseSnapshot: result as unknown as Prisma.InputJsonValue } });
      return result;
    });
  }
}
