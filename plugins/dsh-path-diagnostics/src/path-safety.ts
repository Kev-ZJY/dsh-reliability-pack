import { isAbsolute, relative, resolve, sep } from 'node:path';

export function normalizeWorkspaceRoot(root: string): string | undefined {
  if (typeof root !== 'string' || root.trim().length === 0) return undefined;
  return resolve(root);
}

export function normalizeContainedPath(root: string, candidate: string): string | undefined {
  if (typeof candidate !== 'string' || candidate.length === 0) return undefined;
  const normalized = resolve(root, candidate);
  return isWithinWorkspace(root, normalized) ? normalized : undefined;
}

export function isWithinWorkspace(root: string, candidate: string): boolean {
  const workspace = resolve(root);
  const normalizedCandidate = resolve(candidate);
  const distance = relative(workspace, normalizedCandidate);
  return distance === '' || !isAbsolute(distance) && distance !== '..' && !distance.startsWith(`..${sep}`);
}
