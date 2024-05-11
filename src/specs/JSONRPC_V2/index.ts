export * from './types';

import type { Request, Response, Error, FailedResponse } from './types';

/**
 * The function `buildRequest` takes in a method, an array of parameters, and an optional id, and
 * returns a Request object with the provided values.
 * @param  - - `method`: a string representing the name of the method to be called.
 * @returns an object of type `Request`.
 */
export function buildRequest<T>({
  method,
  params,
  id
}: {
  method: string;
  params: T[];
  id?: number;
}): Request<T> {
  if (!id) id = 1;
  return { jsonrpc: '2.0', method, params, id };
}

/**
 * The function `buildResponse` takes a request and a result, and returns a response object with the
 * JSON-RPC version, request ID, and result.
 * @param  {Request}  `request`: The JSON-RPC request object that was received.
 * @returns a Response object.
 */
export function buildResponse<T, K>({
  request,
  result
}: {
  request: Request<T>;
  result: K;
}): Response<K> {
  return {
    jsonrpc: '2.0',
    id: request.id,
    result
  };
}

/**
 * The function builds an error response object with the provided code, message, and data.
 * @param {Error}  - - `code`: The error code that identifies the type of error.
 * @returns a FailedResponse object.
 */
export function buildError({ code, message, data }: Error): FailedResponse {
  return {
    jsonrpc: '2.0',
    error: { code, message, data }
  };
}
