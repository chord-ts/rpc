import { json } from '@sveltejs/kit';
import { Composer, rpc, depends } from '../../../../../src/';
import { sveltekitMiddleware } from '../../../../../src/middlewares';
import { redirect } from '@sveltejs/kit';


class Crud {

  @rpc()
  pong() {
    return 'pong'
  }

  @rpc()
  async ping() {
    throw redirect(303, '/redirectTest/in') 
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
  // event.locals.username = event.cookies.get('username')
  // return json(await composer.exec(event));
  throw redirect(303, '/redirectTest/in')
}
