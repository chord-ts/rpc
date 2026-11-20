import { _composer } from "./+server"

export async function load(event) {
  event.locals.user = 'World'
  const scoped = _composer.createScoped(event.locals)
  const res = await scoped.Service.hello()
  return {res}
}