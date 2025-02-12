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
	pong() {
		return 'pong'
	}

	@rpc()
	async ping(param: string): Promise<string> {
		console.log('enter', this.ctx?.username, param)
		const longAction = await new Promise((resolve) => {
			setTimeout(() => {
				console.log('run in timeout', this.ctx?.username, param)
				resolve(`Hello, ${this.ctx?.username}`)
			}, 5000)
		}) as string
    console.log('done',  this.ctx?.username, param)
		return longAction;
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
