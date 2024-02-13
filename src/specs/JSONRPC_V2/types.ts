/* The `export enum ErrorCode` is defining an enumeration in TypeScript. Each member of the enumeration
represents an error code that can be used in a JSON-RPC response. The values assigned to each member
are the numeric error codes defined in the JSON-RPC specification. */
export enum ErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  ServerError = -32000
}

/* The `Request` interface is defining the structure of a JSON-RPC request object in TypeScript. 
 */
export interface Request {
  jsonrpc: '2.0';
  method: string;
  params: unknown[];
  id: number | null;
}

/* The `export interface Error` is defining an interface in TypeScript that represents an error object
in a JSON-RPC response. It has three properties: */
export interface Error {
  code: ErrorCode | number;
  message: string;
  data?: unknown;
}

/* The `Response` interface is defining the structure of a JSON-RPC response object in TypeScript. */
export interface Response {
  jsonrpc: '2.0';
  result: unknown;
  id: number | null;
}

/* The `FailedResponse` interface is defining the structure of a JSON-RPC response object when the
request has failed. It has two properties: */
export interface FailedResponse {
  jsonrpc: '2.0';
  error: Error;
}

export type Some<T, K> = T | K;

export type SomeResponse = Some<Response, FailedResponse>;
export type BatchRequest = Request[];
export type BatchResponse = SomeResponse[];
