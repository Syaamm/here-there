import { Controller, Get, Header } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Public } from '../common/auth';
import { E } from '../common/errors';
import { API_ROOT } from './generate';

let cached: unknown;

/** The machine-readable API description (OpenAPI 3.1), written by `npm run docs` and read from docs/openapi.json. */
@Controller('v1')
export class DocsController {
  @Public()
  @Get('openapi.json')
  @Header('Cache-Control', 'public, max-age=300')
  openapi() {
    if (cached) return cached;
    const file = path.join(API_ROOT, 'docs', 'openapi.json');
    if (!existsSync(file)) throw E.notFound('API description');
    return (cached = JSON.parse(readFileSync(file, 'utf8')));
  }
}
