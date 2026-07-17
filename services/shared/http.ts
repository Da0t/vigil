/**
 * Small HTTP + process-lifecycle helpers shared by the backend services:
 *   - asyncHandler: forward async route rejections to Express's error chain
 *     (Express 4 does not catch them itself).
 *   - errorHandler: terminal Express error middleware → 500 (never leak stacks).
 *   - installSafetyNets / installSignalHandlers / onShutdown: global crash nets
 *     and graceful SIGTERM/SIGINT shutdown.
 *
 * Express types are imported type-only, so this module stays free of a runtime
 * express dependency.
 */
import type { ErrorRequestHandler, RequestHandler } from "express";

/** Wrap an async Express handler so a rejected promise reaches the error middleware. */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** Terminal Express error middleware. Register last: app.use(errorHandler(service)). */
export function errorHandler(service: string): ErrorRequestHandler {
  return (err, req, res, _next) => {
    console.error(`[${service}] unhandled error on ${req.method} ${req.path}:`, err);
    if (!res.headersSent) res.status(500).json({ error: "internal error" });
  };
}

type Closer = () => Promise<void> | void;
const closers: Closer[] = [];
let shuttingDown = false;

/** Register a resource to close on shutdown (server, store connection, intervals). */
export function onShutdown(fn: Closer): void {
  closers.push(fn);
}

/** Run all closers once, then exit. Safe to call repeatedly. */
export async function shutdown(service: string, code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[${service}] shutting down (${closers.length} closers, exit ${code})`);
  for (const c of closers) {
    try {
      await c();
    } catch (e) {
      console.error(`[${service}] shutdown closer failed:`, e);
    }
  }
  process.exit(code);
}

/** Log unhandled rejections; on uncaught exception, shut down cleanly (fail safe). */
export function installSafetyNets(service: string): void {
  process.on("unhandledRejection", (reason) => {
    console.error(`[${service}] unhandledRejection:`, reason);
  });
  process.on("uncaughtException", (err) => {
    console.error(`[${service}] uncaughtException:`, err);
    void shutdown(service, 1);
  });
}

/** Graceful shutdown on SIGTERM/SIGINT. */
export function installSignalHandlers(service: string): void {
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      console.log(`[${service}] ${sig} received`);
      void shutdown(service, 0);
    });
  }
}
