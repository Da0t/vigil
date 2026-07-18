import express from "express";
import cors from "cors";
import { z } from "zod";
import { VLOG_LINE, type DiagnoseResponse } from "./contract-lite";
import { AUTH_ENABLED, ATTEST_ENABLED, env, logWorkerConfig } from "./env";
import { captureRawBody, requireInternalAuth, signAttestation } from "./auth-lite";

const diagnoseSchema = z.object({
  service: z.string().min(1),
  deployId: z.string().min(1),
  candidateAction: z.string().min(1),
  rawLogs: z.string(),
});

const PORT = env.PORT;
const requireAuth = requireInternalAuth({ secret: env.VIGIL_INTERNAL_SECRET, enabled: AUTH_ENABLED });

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb", verify: captureRawBody }));

app.get("/health", (_req, res) => { res.json({ ok: true, role: "vigil-diagnostic-worker" }); });

app.post("/diagnose", requireAuth, (req, res) => {
  const parsed = diagnoseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid request body",
      issues: parsed.error.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message })),
    });
    return;
  }
  const { service, deployId, candidateAction, rawLogs } = parsed.data;

  const errors: { component: string; code: string; rest: string }[] = [];
  let sawDeployMarker = false;
  for (const line of (rawLogs ?? "").split("\n")) {
    const m = VLOG_LINE.exec(line.trim());
    if (!m?.groups) continue;
    if (m.groups.code === "DEPLOY_APPLIED" && m.groups.rest.includes(`deploy=${deployId}`)) sawDeployMarker = true;
    if (m.groups.lvl === "E") errors.push({ component: m.groups.component, code: m.groups.code, rest: m.groups.rest });
  }

  const top = <K extends "component" | "code">(k: K) => {
    const map = new Map<string, number>();
    for (const e of errors) map.set(e[k], (map.get(e[k]) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1])[0];
  };
  const topComponent = top("component");
  const topCode = top("code");
  const dominant = topComponent && errors.length > 0 && topComponent[1] / errors.length > 0.7;
  const cfgRelated = !!topCode && /CFG|TIMEOUT|CONFIG/.test(topCode[0]);
  const referencesDeploy = errors.some((e) => e.rest.includes(`deploy=${deployId}`));

  const checks = [
    { name: "errors_present", passed: errors.length > 0, detail: `${errors.length} error lines` },
    { name: "single_component_dominates", passed: !!dominant, detail: topComponent?.[0] },
    { name: "signature_is_config_related", passed: cfgRelated, detail: topCode?.[0] },
    { name: "errors_reference_deploy", passed: referencesDeploy || sawDeployMarker, detail: deployId },
  ];
  const passed = checks.every((c) => c.passed);

  // Sign the result so the gate can trust `sandboxPassed` without trusting the
  // agent. Only the worker holds WORKER_ATTEST_SECRET.
  const attestation =
    ATTEST_ENABLED && env.WORKER_ATTEST_SECRET
      ? signAttestation(env.WORKER_ATTEST_SECRET, service, deployId, passed)
      : undefined;

  const response: DiagnoseResponse = {
    sandboxPassed: passed,
    rootCause: passed
      ? `deploy ${deployId} changed ${topComponent?.[0]} config handling (${topCode?.[0]})`
      : "evidence inconclusive — human review required",
    recommendedAction: passed ? candidateAction : "escalate",
    checks,
    attestation,
  };
  // Emit a structured line carrying the correlation ID so one incident is
  // traceable across the agent → worker hop (worker is an isolated build context
  // and cannot import the shared pino logger).
  const cid = req.headers["x-vigil-correlation-id"];
  console.log(JSON.stringify({
    service: "diagnostic-worker",
    correlationId: Array.isArray(cid) ? cid[0] : cid,
    msg: "diagnose",
    subject: `${service}/${deployId}`,
    sandboxPassed: passed,
    attested: !!attestation,
  }));
  res.json(response);
});

// Global safety nets + graceful shutdown (inline — isolated build context).
process.on("unhandledRejection", (r) => console.error("[diagnostic-worker] unhandledRejection:", r));
process.on("uncaughtException", (e) => { console.error("[diagnostic-worker] uncaughtException:", e); process.exit(1); });

const server = app.listen(PORT, () => { logWorkerConfig(); console.log(`[diagnostic-worker] :${PORT}`); });

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => { console.log(`[diagnostic-worker] ${sig} received`); server.close(() => process.exit(0)); });
}
