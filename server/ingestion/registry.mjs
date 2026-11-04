import { arxivSource } from './sources/arxiv.mjs';

// Built-in trusted adapters. Plugins are registered in code, never loaded as
// executable user-provided scripts from the database.
export const sourcePlugins = new Map([
  [arxivSource.id, arxivSource],
]);

export function getSourcePlugin(id) {
  return sourcePlugins.get(id) ?? null;
}
