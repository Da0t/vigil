/**
 * contract-lite — intentional, self-contained duplicate of the shapes this
 * container needs from src/lib/contract.ts.
 *
 * The diagnostic worker is built into a Docker image whose build context is
 * ONLY this folder, so it cannot import ../../src/lib/contract. Keep these
 * shapes byte-consistent with src/lib/contract.ts by hand.
 */

export interface DiagnoseRequest {
  service: string;
  deployId: string;
  candidateAction: string;
  rawLogs: string;
}

export interface DiagnoseResponse {
  sandboxPassed: boolean;
  rootCause: string;
  recommendedAction: string;
  checks: { name: string; passed: boolean; detail?: string }[];
  /** Worker-signed attestation over {service, deployId, sandboxPassed}. */
  attestation?: string;
}

export const VLOG_LINE =
  /^\|(?<lvl>[EWI])\|(?<ts>\d+)\|(?<component>[\w-]+)\|(?<code>[A-Z_]+)\|(?<rest>.*)$/;
