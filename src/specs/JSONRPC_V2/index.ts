export * from './types';

import type { Request, Response, Error, FailedResponse } from './types';
export function buildRequest({
  method,
  params,
  id
}: {
  method: string;
  params: unknown[];
  id?: number;
}): Request {
  if (!id) id = 1;
  return { jsonrpc: '2.0', method, params, id };
}

export function buildResponse({
  request,
  result
}: {
  request: Request;
  result: unknown;
}): Response {
  return {
    jsonrpc: '2.0',
    id: request.id,
    result
  };
}

export function buildError({ code, message, data }: Error): FailedResponse {
  return {
    jsonrpc: '2.0',
    error: { code, message, data }
  };
}
