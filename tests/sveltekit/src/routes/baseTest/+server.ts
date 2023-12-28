import { json } from '@sveltejs/kit';
import { Composer, rpc, depends } from '../../../../../src/';
// import { Composer, rpc, depends } from '@chord-ts/rpc';
// import cache from '@chord-ts/rpc/middlewares/cache';
import { sveltekitMiddleware } from '@chord-ts/rpc/middlewares';
// import {sveltekitMiddleware} from '../../../../../src/middlewares';

// THIS IS CONTROLLER

interface Context {
	sb: unknown;
}

class TestRPC {
	@depends()
	private readonly ctx!: Context;

	@rpc()
	dbReq(param: number): string {
		// console.log('!ctx injected ', this.rpc2);
		// console.log('ctx injected ', this.ctx);
		// throw Error('Произошла ошибка!')
		return `Hello from TestRPC, ${param}`;
	}

	dbReq2(param: string): string {
		return `Hello dbReq2, ${param}`;
	}
}

// function testMode() {
//   return async function h(event, ctx, next) {
//     console.log(event, ctx, )
//     return buildResponse({request: event.raw, result: 'hello!!!!'})
//   }
// }

const testCache = {
	async get(k) {
		throw TypeError('hh');
		return 'Cached hello';
	},
	async set(k, v, ttl) {
		console.log('set', k, v, ttl);
	}
};

class TestRPC2 {
	@rpc()
	dbReq(param: number): string {
		return `Hello from TestRPC2, ${param}!`;
	}

	@rpc()
	dbReq3(param: string, param2: number): string {
		return `Hello from TestRPC2 dbReq3, ${param} ${param2}!`;
	}
}

const composer = Composer.init({ TestRPC: new TestRPC(), TestRPC2: new TestRPC2() });

composer.use(sveltekitMiddleware());

export type Client = typeof composer.clientType;

export async function POST(event) {
	return json(await composer.exec(event));
}
