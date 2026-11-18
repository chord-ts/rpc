// Message→HTTP projection: the generic bridge protocol factories use to build their http view.
// Lives in the protocol layer (below transport): the protocol hands the adapter its contract,
// the adapter stays protocol-agnostic. Self-addressed protocols (jsonrpc/mcp/capnweb) get HTTP
// for free: value in → value out, status 200/204 from the presence of a reply.

import type { Binding, MessageBinding } from '../types';

export function messageToHttp(mb: MessageBinding): Binding {
  return {
    async handle(req, ctx) {
      const value = await mb.handle(req.body, ctx);
      return value == null ? { status: 204, body: null } : { status: 200, body: value };
    },
  };
}
