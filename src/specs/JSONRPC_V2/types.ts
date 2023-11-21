export enum ErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  ServerError = -32000
}

export interface Request {
  jsonrpc: '2.0';
  method: string;
  params: unknown[];
  id: number | null;
}

export interface Error {
  code: ErrorCode | number;
  message: string;
  data?: unknown;
}

export interface Response {
  jsonrpc: '2.0';
  result: unknown;
  id: number | null;
}

export interface FailedResponse {
  jsonrpc: '2.0';
  error: Error;
}

export type Some<T, K> = T | K;

export type SomeResponse = Some<Response, FailedResponse>;
export type BatchRequest = Request[];
export type BatchResponse = SomeResponse[];
