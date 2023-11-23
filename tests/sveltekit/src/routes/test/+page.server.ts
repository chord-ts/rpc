import { composer } from './+server';

export async function load() {
  return { schema: composer.getSchema() };
}
