export interface PresencePolicy { heartbeatMs: number; staleMs: number; offlineMs: number }
export function presencePolicy(): PresencePolicy {
  const policy = { heartbeatMs: Number(process.env.OPERATOR_HEARTBEAT_MS || 20000), staleMs: Number(process.env.OPERATOR_STALE_MS || 60000), offlineMs: Number(process.env.OPERATOR_OFFLINE_MS || 120000) };
  if (!Object.values(policy).every(value => Number.isInteger(value) && value >= 1000) || policy.staleMs < policy.heartbeatMs * 2 || policy.offlineMs <= policy.staleMs) throw new Error('Intervalos de presença inválidos.');
  return policy;
}
export function sessionPresence(session: { active: boolean; endedAt: Date | null; expiresAt: Date; lastSeenAt: Date | null; operator: { active: boolean }; workstation: { active: boolean } }, now = new Date(), policy = presencePolicy()): 'ONLINE' | 'STALE' | 'OFFLINE' {
  if (!session.active || session.endedAt || session.expiresAt <= now || !session.operator.active || !session.workstation.active || !session.lastSeenAt || session.lastSeenAt > now) return 'OFFLINE';
  const elapsed = now.getTime() - session.lastSeenAt.getTime();
  return elapsed >= policy.offlineMs ? 'OFFLINE' : elapsed >= policy.staleMs ? 'STALE' : 'ONLINE';
}
