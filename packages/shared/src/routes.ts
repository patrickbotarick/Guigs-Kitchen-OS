import { z } from 'zod';
export const routeUpdatedSchema = z.object({ eventId: z.string().uuid(), routeId: z.string().cuid(), version: z.number().int().nonnegative(), timestamp: z.string().datetime() }).strict();
export type RouteUpdated = z.infer<typeof routeUpdatedSchema>;
export const routeCommandSchema = z.object({
  command: z.enum(['CREATE', 'ADD', 'REMOVE', 'MOVE', 'CLOSE', 'REOPEN', 'DISPATCH']), clientCommandId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative().optional(), pizzaId: z.string().cuid().optional(),
  targetRouteId: z.string().cuid().optional(), targetExpectedVersion: z.number().int().nonnegative().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.command !== 'CREATE' && value.expectedVersion === undefined) ctx.addIssue({ code: 'custom', message: 'Versão obrigatória.' });
  if (['ADD', 'REMOVE', 'MOVE'].includes(value.command) && !value.pizzaId) ctx.addIssue({ code: 'custom', message: 'Pizza obrigatória.' });
  if (value.command === 'MOVE' && (!value.targetRouteId || value.targetExpectedVersion === undefined)) ctx.addIssue({ code: 'custom', message: 'Rota de destino e versão obrigatórias.' });
  if (!['ADD', 'REMOVE', 'MOVE'].includes(value.command) && value.pizzaId !== undefined) ctx.addIssue({ code: 'custom', message: 'Pizza não se aplica a este comando.' });
  if (value.command !== 'MOVE' && (value.targetRouteId !== undefined || value.targetExpectedVersion !== undefined)) ctx.addIssue({ code: 'custom', message: 'Destino só se aplica ao movimento.' });
  if (value.command === 'CREATE' && value.expectedVersion !== undefined) ctx.addIssue({ code: 'custom', message: 'Criação não aceita versão prévia.' });
});
export type RouteCommandInput = z.infer<typeof routeCommandSchema>;
export interface DispatchRouteView {
  id: string; routeNumber: number; status: 'OPEN' | 'CLOSED' | 'DISPATCHED'; version: number;
  createdAt: string; closedAt: string | null; reopenedAt: string | null; dispatchedAt: string | null;
  items: { pizzaId: string; orderId: string; addedAt: string }[];
}
