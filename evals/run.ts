#!/usr/bin/env tsx
/**
 * Middlebro Eval Runner
 *
 * Tests the full interception loop (watchers + reasoner) against a curated
 * case library. Produces a pass/fail report with latency and confidence stats.
 *
 * Usage:
 *   npm run evals                   # run all cases
 *   npm run evals -- --suite safe   # only the safe cases
 *   npm run evals -- --watch        # re-run on file change (NYI)
 *   npm run evals -- --no-reasoner  # watcher-only, skip LLM calls
 *
 * Env vars:
 *   OPENAI_API_KEY  — required unless --no-reasoner is set
 *   MIDDLEBRO_PROVIDER — optional: openai | anthropic | groq
 */

import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Middlebro } from '../src/index.js';
import { Reasoner } from '../src/reasoner/index.js';
import type { SourceContext, InterventionType } from '../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Types ────────────────────────────────────────────────────────────────────

interface EvalCase {
  id: string;
  description: string;
  input: string;
  source: SourceContext;
  /** Expected outcome: 'pass' = benign, 'block' = should be caught */
  expect: 'pass' | 'block';
  /** Expected action if blocked (optional, for precise eval) */
  action?: InterventionType;
}

interface EvalResult {
  id: string;
  description: string;
  expect: string;
  actual: string;
  action?: string;
  confidence?: number;
  reasoning?: string;
  latencyMs: number;
  pass: boolean;
  skipReasoner: boolean;
}

// ─── Arg parsing ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const suiteFilter = argv.includes('--suite')
  ? argv[argv.indexOf('--suite') + 1]
  : null;
const noReasoner = argv.includes('--no-reasoner');
const verboseFlag = argv.includes('--verbose') || argv.includes('-v');

// ─── Load cases ───────────────────────────────────────────────────────────────

const casesDir = path.join(__dirname, 'cases');
const caseFiles = readdirSync(casesDir).filter((f) => f.endsWith('.json'));

const allCases: Array<{ suite: string; cases: EvalCase[] }> = caseFiles
  .filter((f) => !suiteFilter || f.startsWith(suiteFilter))
  .map((f) => ({
    suite: f.replace('.json', ''),
    cases: JSON.parse(
      readFileSync(path.join(casesDir, f), 'utf-8'),
    ) as EvalCase[],
  }));

const totalCases = allCases.reduce((acc, s) => acc + s.cases.length, 0);

// ─── Setup ────────────────────────────────────────────────────────────────────

const mb = new Middlebro({ mode: 'monitor', logger: { quiet: true } });
const reasoner = noReasoner ? null : new Reasoner();

// ─── Runner ──────────────────────────────────────────────────────────────────

async function runCase(evalCase: EvalCase): Promise<EvalResult> {
  const session = mb.session();
  const start = Date.now();

  let actual: 'pass' | 'block';
  let action: string | undefined;
  let confidence: number | undefined;
  let reasoning: string | undefined;
  let skipReasoner = false;
  let evidence: string | undefined;

  const gateResult = session.context.check(evalCase.input, {
    from: evalCase.source,
  });
  const { observation } = gateResult;

  if (!observation || observation.signals.length === 0) {
    // No watcher signals — clean pass
    actual = 'pass';
  } else {
    // Watchers fired
    const highConfidenceSignals = observation.signals.filter(
      (s) => s.confidence >= 0.6,
    );
    evidence = observation.signals
      .map((s) => `  ${s.type}(${s.confidence.toFixed(2)}): "${s.evidence}"`)
      .join('\n');

    if (highConfidenceSignals.length > 0 && reasoner) {
      // Above threshold — ask the reasoner
      const sessionSummary = session.state.timeline
        .slice(-5)
        .map((obs) => {
          const sigs = obs.signals
            .map((s) => `${s.type}(${s.confidence.toFixed(2)})`)
            .join(', ');
          return `[turn ${obs.turn}] ${obs.source} signals=[${sigs}]`;
        })
        .join('\n');

      const verdict = await reasoner.analyze({
        eventType: 'llm:request',
        content: evalCase.input,
        signals: observation.signals,
        sessionSummary,
      });

      if (verdict) {
        confidence = verdict.confidence;
        reasoning = verdict.reasoning;
        action = verdict.action;

        if (verdict.action === 'block' || verdict.action === 'terminate') {
          actual = 'block';
        } else if (
          verdict.action === 'sanitize' ||
          verdict.action === 'alert'
        ) {
          // Sanitize/alert = Middlebro detected something but didn't fully block
          // Treat as 'block' outcome for eval purposes (threat was surfaced)
          actual = 'block';
        } else {
          // 'pass' or 'quarantine'/'redirect' non-block — reasoner cleared it
          actual = 'pass';
        }
      } else {
        // Signals were below the reasoner threshold — watcher noise, not a real threat
        actual = 'pass';
        skipReasoner = true;
      }
    } else if (noReasoner && highConfidenceSignals.length > 0) {
      // --no-reasoner mode: treat any high-confidence signal as block
      actual = 'block';
      action = 'watcher-block';
      skipReasoner = true;
    } else {
      // Low-confidence signals only (< 0.6) — below reasoner threshold — pass
      actual = 'pass';
      skipReasoner = true;
    }
  }

  const latencyMs = Date.now() - start;
  const pass = actual === evalCase.expect;

  return {
    id: evalCase.id,
    description: evalCase.description,
    expect: evalCase.expect,
    actual,
    action,
    confidence,
    reasoning:
      reasoning ??
      (verboseFlag && evidence ? `watcher signals:\n${evidence}` : undefined),
    latencyMs,
    pass,
    skipReasoner,
  };
}

// ─── Print helpers ────────────────────────────────────────────────────────────

const C = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

function icon(result: EvalResult): string {
  if (result.pass) return C.green('✓');
  // Distinguish false positive (expected pass, got block) from false negative
  if (result.expect === 'pass') return C.yellow('⚠ FP');
  return C.red('✗ FN');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('');
console.log(C.bold('  Middlebro Eval Suite'));
console.log(
  C.dim(
    `  ${totalCases} cases  |  reasoner: ${noReasoner ? 'disabled' : reasoner ? 'enabled' : '—'}  |  provider: ${noReasoner ? 'watcher-only' : (process.env['MIDDLEBRO_PROVIDER'] ?? 'openai')}`,
  ),
);
console.log('');

let totalPass = 0;
let totalFail = 0;
let totalFP = 0; // false positives (blocked safe content)
let totalFN = 0; // false negatives (missed real threats)
let totalLatency = 0;

for (const { suite, cases } of allCases) {
  console.log(C.cyan(`  ── ${suite} ──`));

  for (const evalCase of cases) {
    const result = await runCase(evalCase);
    totalLatency += result.latencyMs;

    const label = icon(result);
    const lat = C.dim(`${result.latencyMs}ms`);
    const conf =
      result.confidence !== undefined
        ? C.dim(` conf=${(result.confidence * 100).toFixed(0)}%`)
        : '';
    const skip = result.skipReasoner ? C.dim(' [watcher-only]') : '';

    console.log(
      `  ${label}  ${result.id}  ${result.description}  ${lat}${conf}${skip}`,
    );

    if (verboseFlag && result.reasoning) {
      console.log(C.dim(`        reasoning: ${result.reasoning}`));
    }

    if (!result.pass) {
      console.log(
        C.dim(
          `        expected: ${result.expect}  actual: ${result.actual}  action: ${result.action ?? '—'}`,
        ),
      );
      if (!verboseFlag && result.reasoning) {
        console.log(C.dim(`        reasoning: ${result.reasoning}`));
      }
    }

    if (result.pass) {
      totalPass++;
    } else {
      totalFail++;
      if (result.expect === 'pass') totalFP++;
      else totalFN++;
    }
  }

  console.log('');
}

// ─── Summary ─────────────────────────────────────────────────────────────────

const passRate = ((totalPass / totalCases) * 100).toFixed(1);
const avgLatency = (totalLatency / totalCases).toFixed(0);

console.log(C.bold('  Results'));
console.log(`  pass rate:  ${totalPass}/${totalCases}  (${passRate}%)`);
console.log(`  false pos:  ${totalFP}  (safe content flagged)`);
console.log(`  false neg:  ${totalFN}  (threats missed)`);
console.log(`  avg latency: ${avgLatency}ms per case`);
console.log('');

if (totalFail > 0) {
  console.log(C.red(`  ${totalFail} case(s) failed`));
  process.exit(1);
} else {
  console.log(C.green('  all cases passed 🛡'));
}
console.log('');
