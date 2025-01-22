import { json } from '@sveltejs/kit';
import { Composer, rpc, depends } from '../../../../../src/';
import {sveltekitMiddleware} from '../../../../../src/middlewares';

// THIS IS CONTROLLER

interface Context {
	sb: unknown;
}

class Crud {
	@depends()
  private ctx!: {username: string}

	@rpc()
	ping(param: string): string {
    console.log('ping', param)
		return `Hello, ${this.ctx?.username}`;
	}
}

// function testMode() {
//   return async function h(event, ctx, next) {
//     console.log(event, ctx, )
//     return buildResponse({request: event.raw, result: 'hello!!!!'})
//   }
// }




const composer = Composer.init({ Crud: new Crud() });

composer.use(sveltekitMiddleware());

export type Client = typeof composer.clientType;


export async function POST(event) {
  event.locals.username = event.cookies.get('username')
	return json(await composer.exec(event));
}
