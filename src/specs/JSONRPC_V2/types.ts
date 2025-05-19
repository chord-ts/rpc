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
export interface Request<T extends Parameters> {
  jsonrpc: '2.0';
  method: string;
  params: T | T[];
  id: number | null;
}

export type Value = string | number | null | boolean | Value[] | Record<string, unknown>
export type Obj = Record<string, Value> 
export type Arr = Value[]
export type Parameters = Obj | Arr

/* The `export interface Error` is defining an interface in TypeScript that represents an error object
in a JSON-RPC response. It has three properties: */
export interface Error {
  code: ErrorCode | number;
  name: string;
  message: string;
  data?: unknown;
  reason?: string;
}

/* The `Response` interface is defining the structure of a JSON-RPC response object in TypeScript. */
export interface Response<T extends Value> {
  jsonrpc: '2.0';
  result: T | T[];
  id: number | null;
}

/* The `FailedResponse` interface is defining the structure of a JSON-RPC response object when the
request has failed. It has two properties: */
export interface FailedResponse {
  jsonrpc: '2.0';
  error: Error;
}

export type Some<T, K> = T | K;

export type BatchRequest<T extends Parameters> = Request<T>[];

export type SomeResponse<T extends Value> = Some<Response<T>, FailedResponse>;
export type BatchResponse<T extends Value> = SomeResponse<T>[];
