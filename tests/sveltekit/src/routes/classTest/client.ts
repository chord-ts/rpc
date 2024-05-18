import { client } from '../../../../../src/';
import type {Client} from './+server'

const rpc = client<Client>({endpoint: '/classTest'})
export const {Logger: logger, Service: service} = rpc
console.log('get rpc', logger.debug, service.hello)