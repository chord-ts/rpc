import type { Handle } from '@sveltejs/kit';

// locals — нативный контекст SvelteKit: fromSvelteKit передаёт его в binding как ctx,
// compose inject достаёт оттуда зависимости по именам параметров конструктора.
// CORS спеки ставит сам openrpc-binding (Access-Control-Allow-Origin: playground.open-rpc.org).
export const handle: Handle = ({ event, resolve }) => {
  event.locals.user = 'demo-user';
  return resolve(event);
};