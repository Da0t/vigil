/**
 * Shared observability: structured logging (pino), a correlation ID propagated
 * across the agent→gate→payments call chain, Prometheus metrics (prom-client),
 * and env-gated error reporting (Sentry) + tracing (OpenTelemetry) hooks.
 */
import { randomUUID } from "node:crypto";
import pino, { type Logger } from "pino";
import client from "prom-client";
import type { RequestHandler } from "express";

export const CORRELATION_HEADER = "x-vigil-correlation-id";

/** JSON structured logger with the service name baked in. LOG_LEVEL overrides. */
export function createLogger(service: string): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? (process.env.VIGIL_ENV === "production" ? "info" : "debug"),
    base: { service },
  });
}

/**
 * Read (or mint) a correlation ID for each request, echo it back on the
 * response, and attach a child logger (req.log) that stamps every line with it.
 * Downstream services receive the same ID via the CORRELATION_HEADER, so one
 * incident is traceable across every service by a single ID.
 */
export function correlationMiddleware(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const header = req.headers[CORRELATION_HEADER];
    const cid = (Array.isArray(header) ? header[0] : header) || randomUUID();
    (req as { correlationId?: string }).correlationId = cid;
    (req as { log?: Logger }).log = logger.child({ correlationId: cid });
    res.setHeader(CORRELATION_HEADER, cid);
    next();
  };
}

/* --------------------------- Prometheus metrics --------------------------- */

export const metrics = client;
export const registry = client.register;

let defaultsCollected = false;
/** Call once at boot to register default process/runtime metrics. */
export function initMetrics(): void {
  if (defaultsCollected) return;
  defaultsCollected = true;
  client.collectDefaultMetrics();
}

/** GET /metrics handler (Prometheus text exposition). */
export function metricsHandler(): RequestHandler {
  return async (_req, res) => {
    res.setHeader("content-type", registry.contentType);
    res.end(await registry.metrics());
  };
}

/* ----------------- Error reporting (Sentry-compatible) -------------------- */

let sentry: { captureException(e: unknown): void } | null = null;

/** Initialize Sentry if SENTRY_DSN is set and @sentry/node is installed (optional dep). */
export async function initErrorReporting(service: string): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    // Optional dependency — only needed when error reporting is enabled.
    const mod = (await import(/* @vite-ignore */ "@sentry/node" as string)) as {
      init(o: unknown): void;
      captureException(e: unknown): void;
    };
    mod.init({ dsn, environment: process.env.VIGIL_ENV ?? "development", serverName: service });
    sentry = mod;
    console.log(`[${service}] error reporting: Sentry enabled`);
  } catch {
    console.warn(`[${service}] SENTRY_DSN set but @sentry/node not installed — skipping`);
  }
}

/** Forward an error to Sentry when enabled (no-op otherwise). */
export function captureError(e: unknown): void {
  sentry?.captureException(e);
}

/* --------------------- Tracing (OpenTelemetry, optional) ------------------ */

/**
 * Start OpenTelemetry auto-instrumentation when OTEL_EXPORTER_OTLP_ENDPOINT is
 * set and the @opentelemetry packages are installed (optional deps). Traces
 * span the incident loop and every service-to-service HTTP call.
 */
export async function initTracing(service: string): Promise<void> {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  try {
    const { NodeSDK } = (await import(/* @vite-ignore */ "@opentelemetry/sdk-node" as string)) as {
      NodeSDK: new (o: unknown) => { start(): void };
    };
    const { getNodeAutoInstrumentations } = (await import(
      /* @vite-ignore */ "@opentelemetry/auto-instrumentations-node" as string
    )) as { getNodeAutoInstrumentations(): unknown };
    new NodeSDK({ serviceName: service, instrumentations: [getNodeAutoInstrumentations()] }).start();
    console.log(`[${service}] tracing: OpenTelemetry enabled`);
  } catch {
    console.warn(`[${service}] OTEL endpoint set but @opentelemetry packages not installed — skipping`);
  }
}
