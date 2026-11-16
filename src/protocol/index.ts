// Protocol layer: bindings named by protocol. Peers don't import each other. Each builds on the
// core gasket (call/notify/endpoints), generate (docs/discovery/tools), format and schemas.

export { jsonrpc } from './jsonrpc';
export { rest, get, post, put, patch, del, http, type RestContract } from './rest';
export { mcp, type McpMeta } from './mcp';
export { capnweb, capability, type Step, type Path, type Batch, type ServerSession } from './capnweb';