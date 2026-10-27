import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { Public, Scopes } from '../security';
import { AnyScope, V2Idempotent, type V2IdempotencyOptions } from './v2-security';

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';
/** `req`, `res` (passthrough), `body`, `query` o `param:<nombre>`, en el orden de los argumentos del método. */
type ParamSpec = 'req' | 'res' | 'body' | 'query' | `query:${string}` | `param:${string}`;
export interface RouteOptions { scopes?: string[]; anyScope?: string[]; public?: boolean; idempotent?: V2IdempotencyOptions; status?: number; }

const verbs = { get: Get, post: Post, put: Put, patch: Patch, delete: Delete } as const;

/** Declara una clase como controlador v2 y sus dependencias por posición del constructor. */
export function v2Controller(target: new (...args: never[]) => object, path: string, injections: unknown[] = []): void {
  Controller(`api/v2/${path}`.replace(/\/$/, ''))(target);
  injections.forEach((token, index) => Inject(token as string)(target, undefined, index));
}

/** Registra un método como ruta con sus guardas, usando la misma forma manual que los controladores de v1. */
export function v2Route(proto: object, name: string, verb: Verb, path: string, params: ParamSpec[], options: RouteOptions = {}): void {
  const descriptor = Object.getOwnPropertyDescriptor(proto, name)!;
  verbs[verb](path)(proto, name, descriptor);
  params.forEach((spec, index) => {
    if (spec === 'req') Req()(proto, name, index);
    else if (spec === 'res') Res({ passthrough: true })(proto, name, index);
    else if (spec === 'body') Body()(proto, name, index);
    else if (spec === 'query') Query()(proto, name, index);
    else if (spec.startsWith('query:')) Query(spec.slice('query:'.length))(proto, name, index);
    else Param(spec.slice('param:'.length))(proto, name, index);
  });
  if (options.public) Public()(proto, name, descriptor);
  if (options.scopes) Scopes(...options.scopes)(proto, name, descriptor);
  if (options.anyScope) AnyScope(...options.anyScope)(proto, name, descriptor);
  if (options.idempotent) V2Idempotent(options.idempotent)(proto, name, descriptor);
  if (options.status) HttpCode(options.status)(proto, name, descriptor);
}
