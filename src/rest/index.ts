// REST-протокол: declaration sugar (get/post/…) + binding + docs (OpenAPI/Swagger/ReDoc).
export { rest, get, post, put, patch, del, http, HttpError, type RestContract } from './rest';
export { openapi, swagger, redoc } from './docs';
export type { RestMeta } from '@/types';