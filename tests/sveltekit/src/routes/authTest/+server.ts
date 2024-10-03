import {json} from '@sveltejs/kit'

import { Composer, rpc, val} from '../../../../../src';
import { sveltekitMiddleware } from '../../../../../src/middlewares';

class Service {
  @rpc()
  async list() {
    return 'list'
  }

  @rpc()
  async read() {
    return 'read'
  }

  @rpc()
  async update() {
    return 'updated'
  }

  @rpc()
  async delete() {
    return 'ok delete'
  }
}

export const _composer = Composer.init({
  Service2: new Service()
}, 
// {validator: ZodAdapter}
)

_composer.use(sveltekitMiddleware())

export type Client = typeof _composer.clientType

export async function POST(event) {
  return json(await _composer.exec(event))
}


const { Service2 } = _composer;
export const access = {
	READER: [Service2.read, Service2.list],
	WRITER: ['READER', Service2.update],
	ADMIN: ['WRITER', Service2.delete]
};

const access2 = {
	READER: {
		access: [Service2.read, Service2.list],
		WRITER: {
			access: [Service2.update],
			ADMIN: {
				access: [Service2.delete]
			}
		}
	}
};

function preprocess() {
	const flatRoles: Record<string, unknown[]> = {};
	function recursive(obj: typeof access2, role?: string, collected = []) {
    if (role && obj.access) {
      flatRoles[role] = collected.concat(obj.access);
      collected = [...flatRoles[role]]
    }
		for (const [field, desc] of Object.entries(obj)) {
			if (field === 'access') continue
      recursive(desc, field, collected);
		}
	}
	recursive(access2);
  console.log('preprocess', flatRoles)
}

preprocess();