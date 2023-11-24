import type { Middleware } from '../types';

const expressMiddleware: Middleware = async (
  event: Record<string, unknown> | { body: unknown },
  ctx: Record<string, unknown>,
  next: CallableFunction
) => {
  ctx.body = event.body;
  next();
};

export default () => expressMiddleware;
