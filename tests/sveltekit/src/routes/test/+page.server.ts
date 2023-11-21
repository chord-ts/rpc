import { composer } from './+server';

export async function load() {
  console.log(composer.getSchema())
  return { schema: composer.getSchema() };
}
