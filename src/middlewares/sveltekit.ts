async function sveltekitMiddleware(
  event: { request: Request; locals: unknown },
  ctx: Record<string, unknown>,
  next: CallableFunction
) {
  ctx.body = await event.request.json();
  Object.assign(ctx, event.locals);
  next();
}

export default () => sveltekitMiddleware;
