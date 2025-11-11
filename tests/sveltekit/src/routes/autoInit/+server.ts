import { json } from '@sveltejs/kit';
import { Composer, rpc, depends, toRPC } from '../../../../../src/';
import { sveltekitMiddleware } from '../../../../../src/middlewares';

class TestRPC {
	dbReq(param: number): string {
		return `Hello from TestRPC, ${param}`;
	}

	dbReq2(param: string): string {
		return `Hello dbReq2, ${param}`;
	}
	hello() {
		return 'world';
	}
}

class TestRPC2 {
	dbReq(param: number): string {
		return `Hello from TestRPC2, ${param}!`;
	}

	dbReq3(param: string, param2: number): string {
		return `Hello from TestRPC2 dbReq3, ${param} ${param2}!`;
	}
}

const composer = Composer.init({ TestRPC: toRPC(new TestRPC()), TestRPC2: toRPC(new TestRPC2()) });

// composer.TestRPC2
composer.use(sveltekitMiddleware());

export type Client = typeof composer.clientType;

export async function POST(event) {
	return json(await composer.exec(event));
}
