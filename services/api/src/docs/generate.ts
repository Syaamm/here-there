import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { discoverRoutes } from './discover';
import { scanErrorCodes } from './error-scan';
import { buildErrorTable, buildOpenApi } from './openapi';

/** services/api, whether this runs from src (ts) or dist/src (compiled) */
export const API_ROOT = path.resolve(__dirname, __dirname.includes(`${path.sep}dist${path.sep}`) ? '../../..' : '../..');

export function generateDocs(app: INestApplication) {
  const routes = discoverRoutes(app);
  const scan = scanErrorCodes(path.join(API_ROOT, 'src'));
  if (scan.dynamic.length) throw new Error(`Error codes must be written as string literals so they can be documented:\n${scan.dynamic.join('\n')}`);
  const version: string = require(path.join(API_ROOT, 'package.json')).version;
  return {
    routes,
    scan,
    openapi: JSON.stringify(buildOpenApi(routes, scan.codes, version), null, 2) + '\n',
    errorTable: buildErrorTable(scan.codes) + '\n',
  };
}
