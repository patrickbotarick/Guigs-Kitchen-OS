import { randomInt } from 'node:crypto';
import type { Prisma } from '@prisma/client';

export type TiePicker = (count: number) => number;
const mountingStates = ['WAITING_ASSEMBLY', 'ASSEMBLING', 'ASSEMBLY_PAUSED'] as const;

// The order counter write has already acquired the SQLite writer transaction.
// Selection, load accounting and assignments see one consistent database snapshot.
export async function assignNewOrder(tx: Prisma.TransactionClient, orderId: string, clientRequestId: string, pickTie: TiePicker = randomInt) {
  const now = new Date();
  const sessions = await tx.operatorSession.findMany({ where: {
    active: true, endedAt: null, expiresAt: { gt: now }, available: true,
    operator: { active: true }, workstation: { active: true },
  }, orderBy: [{ startedAt: 'desc' }, { id: 'asc' }] });
  // One candidate per operator: multiple tablets do not multiply their chance of selection.
  const representatives = new Map<string, typeof sessions[number]>();
  for (const session of sessions) if (!representatives.has(session.operatorId)) representatives.set(session.operatorId, session);
  const candidates = [...representatives.values()];
  if (!candidates.length) return;
  const grouped = await tx.pizzaItem.groupBy({ by: ['assignedOperatorId'], where: {
    assignedOperatorId: { in: candidates.map(candidate => candidate.operatorId) }, state: { in: [...mountingStates] },
  }, _count: { _all: true } });
  const load = new Map(candidates.map(candidate => [candidate.operatorId, grouped.find(group => group.assignedOperatorId === candidate.operatorId)?._count._all ?? 0]));
  const pizzas = await tx.pizzaItem.findMany({ where: { orderId, state: 'WAITING_ASSEMBLY', assignedOperatorId: null }, orderBy: { position: 'asc' } });
  for (const pizza of pizzas) {
    const minimum = Math.min(...load.values());
    const tied = candidates.filter(candidate => load.get(candidate.operatorId) === minimum);
    const index = tied.length === 1 ? 0 : pickTie(tied.length);
    if (!Number.isInteger(index) || index < 0 || index >= tied.length) throw new Error('Desempate de distribuição inválido.');
    const selected = tied[index];
    const changed = await tx.pizzaItem.updateMany({ where: { id: pizza.id, orderId, state: 'WAITING_ASSEMBLY', version: pizza.version, assignedOperatorId: null }, data: {
      assignedOperatorId: selected.operatorId, assignedWorkstationId: selected.workstationId, assignedSessionId: selected.id, assignedAt: now, version: { increment: 1 },
    } });
    if (changed.count !== 1) throw new Error('Reserva concorrente durante criação do pedido.');
    await tx.pizzaProductionHistory.create({ data: {
      pizzaId: pizza.id, eventType: 'AUTO_ASSIGNED', fromState: pizza.state, toState: pizza.state, changedAt: now,
      actorType: 'SYSTEM', operatorId: selected.operatorId, workstationId: selected.workstationId, operatorSessionId: selected.id,
      commandId: `${clientRequestId}:auto:${pizza.position}`, itemVersion: pizza.version + 1, reason: 'Menor carga de montagem com desempate aleatório',
      metadata: { policy: 'LEAST_PENDING_RANDOM_TIE_V1', loadBefore: minimum, loadAfter: minimum + 1, eligibleOperatorIds: candidates.map(candidate => candidate.operatorId), tiedOperatorIds: tied.map(candidate => candidate.operatorId) },
    } });
    load.set(selected.operatorId, minimum + 1);
  }
  if (pizzas.length) await tx.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } });
}
