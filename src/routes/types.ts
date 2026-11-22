import type { Feed } from '../feed';

export type RouteHandler = (params: Record<string, string>) => Promise<Feed>;
export type Routes = Record<string, RouteHandler>;
