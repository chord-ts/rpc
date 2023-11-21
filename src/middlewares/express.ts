async function expressMiddleware(
  event: { body: unknown; },
  ctx: Record<string, unknown>,
  next: CallableFunction
) {
  ctx.body = event.body
  next();
}

export default () => expressMiddleware;
