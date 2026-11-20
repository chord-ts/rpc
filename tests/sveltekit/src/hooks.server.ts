import type { Handle } from '@sveltejs/kit';

// locals — нативный контекст SvelteKit: fromSvelteKit передаёт его в binding как ctx,
// compose inject достаёт оттуда зависимости по именам параметров конструктора.
export const handle: Handle = ({ event, resolve }) => {
  event.locals.user = 'demo-user';
  return resolve(event);
};