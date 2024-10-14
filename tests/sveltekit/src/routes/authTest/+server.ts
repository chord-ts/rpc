import { json } from '@sveltejs/kit';

import { Composer, Middleware, rpc, val, buildError, ErrorCode, toRPC } from '../../../../../src';
import { sveltekitMiddleware } from '../../../../../src/middlewares';

class Service {
	@rpc()
	async list() {
		return 'list';
	}

	@rpc()
	async read() {
		return 'read';
	}

	@rpc()
	async update() {
		return 'updated';
	}

	@rpc()
	async delete() {
		return 'ok delete';
	}
}

export const _composer = Composer.init(
	{
		Service2: new Service(),
		Service1: new Service()
	}
	// {validator: ZodAdapter}
);

_composer.use(sveltekitMiddleware());
_composer.use(auth());

export type Client = typeof _composer.clientType;

export async function POST(event) {
  return json(await _composer.exec(event));
}

function preprocess<T>(access: T) {
	const flatRoles: Record<string, string[]> = {};
	function recursive(
		obj: { allow: string[]; [k: string]: unknown },
		role?: string,
		collected: string[] = []
	) {
		if (role && obj.allow) {
			flatRoles[role] = collected.concat(obj.allow);
			collected = [...flatRoles[role]];
		}
		for (const [field, desc] of Object.entries(obj)) {
			if (field === 'allow') continue;
			recursive(desc as { allow: string[]; [k: string]: unknown }, field, collected);
		}
	}
	recursive(access as { allow: string[]; [k: string]: unknown });

	const rolesSet: Record<string, Set<string>> = {};
	for (const [role, access] of Object.entries(flatRoles)) {
		rolesSet[role] = new Set(access as string[]);
	}
	return rolesSet;
}

const str = _composer.stringified;
const { Service2 } = str;

const access = {
	READER: {
		allow: [Service2.read, Service2.list],
		WRITER: {
			allow: [Service2.update]
		}
	},
	ADMIN: {
		allow: Service2
	}
};
const roleMap = preprocess(access);

// @ts-ignore

function auth() {
	return async function (event, ctx, next) {
		const userRole = 'READER';
		const { method } = ctx.body;

		if (!roleMap[userRole]?.has(method)) {
			throw Error(`Permission denied for ${userRole} using "${method}"`);
		}
		next();
	};
}
