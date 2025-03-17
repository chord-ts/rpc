import { json } from '@sveltejs/kit';
import { Composer, rpc, depends } from '../../../../../src/';
import {sveltekitMiddleware} from '../../../../../src/middlewares';
import * as devalue from 'devalue';

interface Context {
	sb: unknown;
}

class TestRPC {
	@depends()
	private readonly ctx!: Context;

	@rpc()
	dbReq() {
		return {
			date: new Date(),
			bigint: BigInt(133333333)
		};
	}
}


const composer = Composer.init({ TestRPC: new TestRPC() });

composer.use(sveltekitMiddleware());

export type Client = typeof composer.clientType;

export async function POST(event) {

	const test = devalue.stringify(await composer.exec(event))
	console.log(test)
	return json(test);
}
