import type { PGlite } from "@electric-sql/pglite";

export function freshDb(): Promise<PGlite>;
export function asRole<T>(db: PGlite, role: "anon" | "authenticated", uid: string | null, fn: () => Promise<T>): Promise<T>;
export function createUser(db: PGlite, u: { email: string; verified?: boolean; username?: string }): Promise<string>;
export function encode(points: [number, number, number?][]): string;
