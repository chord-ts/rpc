// Protocol layer: bindings named by protocol. jsonrpc/ — семейство (jsonrpc + mcp-профиль,
// публичный index.ts); пиры rest/capnweb не импортируют друг друга. Each builds on the core
// gasket (call/notify/endpoints), generate (docs/discovery/tools), format and schemas.
// Content-type headers are inlined per response ({ 'content-type': format.contentType }).

export * from './jsonrpc';
export { rest, get, post, put, patch, del, http, type RestContract } from './rest';
export { capnweb, capability, type Step, type Path, type Batch, type ServerSession } from './capnweb';
export { events } from './events';
export { messageToHttp } from './message';