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
	async dbReq(value: BigInt) {
		
    function timeout(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms))
    }
    console.log('start sleep')
    await timeout(4000)

		return {
			input: value,
			date: new Date(),
			bigint: BigInt(133333333)
		};
	}
}


const composer = Composer.init({ TestRPC: new TestRPC() });

async function backendAdapter(event, ctx, next){
	ctx.body = devalue.parse(await event.request.json());
	Object.assign(ctx, event.locals);	
	await next()
}

composer.use(backendAdapter)

export type Client = typeof composer.clientType;

export async function POST(event) {

	const test = devalue.stringify(await composer.exec(event))
	console.log(test)
	return json(test);
}
