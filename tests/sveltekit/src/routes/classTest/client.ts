import { dynamicClient } from '../../../../../src/';
import type {Client} from './+server'

const rpc = dynamicClient<Client>({endpoint: '/classTest'})
export const {Logger: logger, Service: service} = rpc
console.log('get rpc', logger.debug, service.hello)