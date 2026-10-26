import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'] as const;
const BODY = 3;
const QUERY = 4;
const PARAM = 5;

export type FoundRoute = {
  method: (typeof METHODS)[number];
  /** OpenAPI style, e.g. /v1/activities/{id} */
  path: string;
  /** "POST /v1/activities/{id}/requests" */
  key: string;
  controller: string;
  handler: string;
  public: boolean;
  staff: string[] | null;
  pathParams: string[];
  hasBody: boolean;
  queryNames: string[];
  /** @Query() with no name: the whole query string goes to a schema */
  wholeQuery: boolean;
};

const join = (...parts: string[]) => '/' + parts.map((p) => p.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');

/** Every HTTP route the running app really serves, read from the controllers' own decorators. */
export function discoverRoutes(app: INestApplication): FoundRoute[] {
  const out: FoundRoute[] = [];
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const cls = wrapper.metatype as (new (...a: never[]) => unknown) | null;
      if (!cls) continue;
      const base: string = Reflect.getMetadata(PATH_METADATA, cls) ?? '';
      const proto = cls.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const fn = proto[name];
        if (name === 'constructor' || typeof fn !== 'function') continue;
        const verb = Reflect.getMetadata(METHOD_METADATA, fn);
        if (verb === undefined) continue;
        const sub: string = Reflect.getMetadata(PATH_METADATA, fn) ?? '';
        const args: Record<string, { index: number; data?: string }> = Reflect.getMetadata(ROUTE_ARGS_METADATA, cls, name) ?? {};
        const entries = Object.entries(args).map(([k, v]) => ({ type: Number(k.split(':')[0]), data: v.data }));
        const method = METHODS[verb as number];
        const express = join(base, sub);
        const path = express.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
        out.push({
          method,
          path,
          key: `${method} ${path}`,
          controller: cls.name,
          handler: name,
          public: !!Reflect.getMetadata('isPublic', fn) || !!Reflect.getMetadata('isPublic', cls),
          staff: Reflect.getMetadata('staffRoles', fn) ?? Reflect.getMetadata('staffRoles', cls) ?? null,
          pathParams: [...path.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]),
          hasBody: entries.some((e) => e.type === BODY),
          queryNames: entries.filter((e) => e.type === QUERY && e.data).map((e) => e.data!),
          wholeQuery: entries.some((e) => e.type === QUERY && !e.data),
        });
      }
    }
  }
  void PARAM;
  return out.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
}
