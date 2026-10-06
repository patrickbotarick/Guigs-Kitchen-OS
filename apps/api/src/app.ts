import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import { z, ZodError } from 'zod';
import { createOrderSchema, transitionOrderSchema, type OrderHistoryView, type OrderView, type TransitionOrderInput } from '@guigs/shared';
import { OrderNotFoundError, TransitionConflictError } from './orders.js';
import { IdempotencyConflictError, StructuredValidationError, type StructuredOrderService } from './structured-orders.js';
import { createStructuredOrderSchema, type Order } from '@guigs/shared';
import { pizzaCommandSchema } from '@guigs/shared';
import { PizzaCommandConflictError, PizzaCommandNotFoundError, type PizzaCommandService } from './pizza-commands.js';
import { type KitchenNotification } from '@guigs/shared';
import { commandNotifications } from './kitchen-events.js';
import { operatorLoginSchema } from '@guigs/shared';
import { OperationalAuthError, PinLoginError, LoginRateLimitError, SessionResponsibilityConflictError, type OperatorSessionService, type SessionCredentials } from './operator-sessions.js';

export interface OrdersPort {
  create(input: z.infer<typeof createOrderSchema>): Promise<OrderView>;
  listActive(): Promise<OrderView[]>;
  get(id: string): Promise<OrderView | null>;
  history(id: string): Promise<OrderHistoryView[] | null>;
  transition(id: string, input: TransitionOrderInput): Promise<OrderView>;
}

export function createApp(orders: OrdersPort, publish: (event: 'order.created' | 'order.updated', order: OrderView | Order) => void, webOrigin: string | ((origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void) => void), structured?: Pick<StructuredOrderService, 'create' | 'get' | 'listActive'>, commands?: Pick<PizzaCommandService, 'execute'>, publishKitchen?: (notification: KitchenNotification) => void, operators?: Pick<OperatorSessionService, 'signIn' | 'current' | 'end'>) {
  const app = express();
  app.use(cors({ origin: webOrigin }));
  // A valid 30-pizza structured request can exceed the legacy 100kb limit.
  // Keep the old endpoint's parser unchanged.
  app.use('/orders/v2', express.json({ limit: '1mb' }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  const credentials = (req: express.Request): SessionCredentials => ({ token: req.get('Authorization')?.replace(/^Bearer /, '') ?? '', deviceKey: req.get('X-Workstation-Device-Key') ?? '' });
  if (operators) {
    app.post('/operators/session', async (req, res, next) => {
      try { res.set('Cache-Control', 'no-store').status(201).json(await operators.signIn(operatorLoginSchema.parse(req.body), req.ip ?? 'local')); } catch (error) { next(error); }
    });
    app.get('/operators/session', async (req, res, next) => {
      try { res.set('Cache-Control', 'no-store').json(await operators.current(credentials(req))); } catch (error) { next(error); }
    });
    app.delete('/operators/session', async (req, res, next) => {
      try { await operators.end(credentials(req)); res.set('Cache-Control', 'no-store').status(204).end(); } catch (error) { next(error); }
    });
  }
  if (commands) app.post('/orders/v2/:orderId/pizzas/:pizzaId/commands', async (req, res, next) => {
    try {
      const orderId = z.string().cuid().parse(req.params.orderId), pizzaId = z.string().cuid().parse(req.params.pizzaId);
      const result = await commands.execute(orderId, pizzaId, pizzaCommandSchema.parse(req.body), credentials(req));
      // execute resolves after COMMIT; replay and every failed/rolled-back command emit nothing.
      for (const notification of commandNotifications(result)) {
        try { publishKitchen?.(notification); } catch (error) { console.error('Falha na notificação Kitchen após commit:', error); }
      }
      res.set('Idempotency-Replayed', String(result.replayed)).json(result);
    } catch (error) { next(error); }
  });
  if (structured) {
    app.post('/orders/v2', async (req, res, next) => {
      try {
        const result = await structured.create(createStructuredOrderSchema.parse(req.body));
        if (!result.replayed) publish('order.created', result.order);
        res.set('Idempotency-Replayed', String(result.replayed)).status(result.replayed ? 200 : 201).json(result.order);
      } catch (error) { next(error); }
    });
    app.get('/orders/v2', async (_req, res, next) => {
      try { res.json(await structured.listActive()); } catch (error) { next(error); }
    });
    app.get('/orders/v2/:id', async (req, res, next) => {
      try {
        const id = z.string().cuid().parse(req.params.id);
        const order = await structured.get(id);
        if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
        res.json(order);
      } catch (error) { next(error); }
    });
  }
  app.get('/orders', async (_req, res, next) => {
    try { res.json(await orders.listActive()); } catch (error) { next(error); }
  });
  app.get('/orders/:id/history', async (req, res, next) => {
    try {
      const id = z.string().cuid().safeParse(req.params.id);
      if (!id.success) return res.status(400).json({ error: 'ID inválido' });
      const history = await orders.history(id.data);
      if (!history) return res.status(404).json({ error: 'Pedido não encontrado' });
      res.json(history);
    } catch (error) { next(error); }
  });
  app.get('/orders/:id', async (req, res, next) => {
    try {
      const id = z.string().cuid().safeParse(req.params.id);
      if (!id.success) return res.status(400).json({ error: 'ID inválido' });
      const order = await orders.get(id.data);
      if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
      res.json(order);
    } catch (error) { next(error); }
  });
  app.post('/orders', async (req, res, next) => {
    try {
      const input = createOrderSchema.parse(req.body);
      const order = await orders.create(input);
      publish('order.created', order);
      res.status(201).json(order);
    } catch (error) { next(error); }
  });
  app.post('/orders/:id/transition', async (req, res, next) => {
    try {
      const id = z.string().cuid().safeParse(req.params.id);
      if (!id.success) return res.status(400).json({ error: 'ID inválido' });
      const input = transitionOrderSchema.parse(req.body);
      const order = await orders.transition(id.data, input);
      publish('order.updated', order);
      res.json(order);
    } catch (error) { next(error); }
  });

  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    void _next;
    if (error instanceof SessionResponsibilityConflictError) { res.status(409).json({ error: error.message }); return; }
    if (error instanceof OperationalAuthError || error instanceof PinLoginError) { res.status(401).json({ error: error.message }); return; }
    if (error instanceof LoginRateLimitError) { res.set('Retry-After', String(error.retryAfter)).status(429).json({ error: error.message }); return; }
    if (error instanceof ZodError) {
      res.status(400).json({ error: 'Payload inválido', issues: error.flatten() });
      return;
    }
    if (error instanceof PizzaCommandConflictError) { res.status(409).json({ error: error.message }); return; }
    if (error instanceof PizzaCommandNotFoundError) { res.status(404).json({ error: error.message }); return; }
    if (error instanceof StructuredValidationError) {
      res.status(400).json({ error: error.message }); return;
    }
    if (error instanceof IdempotencyConflictError) {
      res.status(409).json({ error: error.message }); return;
    }
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: 'JSON inválido' });
      return;
    }
    if (error instanceof OrderNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof TransitionConflictError) {
      res.status(409).json({ error: error.message });
      return;
    }
    console.error('Erro na API:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  };
  app.use(errorHandler);
  return app;
}
