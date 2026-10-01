import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import { z, ZodError } from 'zod';
import { createOrderSchema, type OrderView } from '@guigs/shared';

export interface OrdersPort {
  create(input: z.infer<typeof createOrderSchema>): Promise<OrderView>;
  listWaiting(): Promise<OrderView[]>;
  get(id: string): Promise<OrderView | null>;
}

export function createApp(orders: OrdersPort, publish: (order: OrderView) => void, webOrigin: string | ((origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void) => void)) {
  const app = express();
  app.use(cors({ origin: webOrigin }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/orders', async (_req, res, next) => {
    try { res.json(await orders.listWaiting()); } catch (error) { next(error); }
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
      publish(order);
      res.status(201).json(order);
    } catch (error) { next(error); }
  });

  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    void _next;
    if (error instanceof ZodError) {
      res.status(400).json({ error: 'Payload inválido', issues: error.flatten() });
      return;
    }
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: 'JSON inválido' });
      return;
    }
    console.error('Erro na API:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  };
  app.use(errorHandler);
  return app;
}
