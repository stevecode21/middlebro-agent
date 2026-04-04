#!/usr/bin/env node
import { createProxyServer } from '../proxy/server.js';
import type { EnforcementMode } from '../types.js';

// ─── Minimal arg parser (no deps) ─────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg?.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      args[key] = (next && !next.startsWith('--')) ? (i++, next) : 'true';
    }
  }
  return args;
}

// ─── Live feed printer ────────────────────────────────────────────────────────

function print(line: string): void {
  process.stdout.write(line + '\n');
}

function printBanner(): void {
  print('');
  print('  ███╗   ███╗██╗██████╗ ██████╗ ██╗     ███████╗██████╗ ██████╗  ██████╗ ');
  print('  ████╗ ████║██║██╔══██╗██╔══██╗██║     ██╔════╝██╔══██╗██╔══██╗██╔═══██╗');
  print('  ██╔████╔██║██║██║  ██║██║  ██║██║     █████╗  ██████╔╝██████╔╝██║   ██║');
  print('  ██║╚██╔╝██║██║██║  ██║██║  ██║██║     ██╔══╝  ██╔══██╗██╔══██╗██║   ██║');
  print('  ██║ ╚═╝ ██║██║██████╔╝██████╔╝███████╗███████╗██████╔╝██║  ██║╚██████╔╝');
  print('  ╚═╝     ╚═╝╚═╝╚═════╝ ╚═════╝ ╚══════╝╚══════╝╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ');
  print('');
  print('  autonomous security agent  —  v0.1.0');
  print('');
}

// ─── Commands ────────────────────────────────────────────────────────────────���

function commandStart(args: Record<string, string>): void {
  const port   = parseInt(args['port'] ?? '4141', 10);
  const mode   = (args['mode'] ?? 'enforce') as EnforcementMode;
  const target = args['target'] ?? process.env['OPENAI_API_URL'] ?? 'https://api.openai.com';

  if (!process.env['OPENAI_API_KEY'] && !args['key']) {
    print('❌  OPENAI_API_KEY is not set. Middlebro needs it to power the reasoner.');
    print('   export OPENAI_API_KEY=sk-...');
    print('   or pass --key sk-...');
    process.exit(1);
  }

  if (args['key']) {
    process.env['OPENAI_API_KEY'] = args['key'];
  }

  printBanner();

  createProxyServer({
    config: { port, targetUrl: target },
    mode,
    onEvent: print,
  });

  process.on('SIGINT', () => {
    print('\n👋  Middlebro shutting down');
    process.exit(0);
  });
}

function commandHelp(): void {
  print('');
  print('  Usage: middlebro <command> [options]');
  print('');
  print('  Commands:');
  print('    start     Start the security proxy daemon');
  print('    help      Show this message');
  print('');
  print('  Options (start):');
  print('    --port    Proxy port (default: 4141)');
  print('    --mode    enforce | monitor | warn  (default: enforce)');
  print('    --target  LLM provider URL (default: https://api.openai.com)');
  print('    --key     OpenAI API key (or set OPENAI_API_KEY env var)');
  print('');
  print('  Example:');
  print('    middlebro start --mode enforce --port 4141');
  print('');
  print('  Then point your agent at Middlebro:');
  print('    OPENAI_BASE_URL=http://127.0.0.1:4141 your-agent');
  print('');
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const command = argv[0] ?? 'help';
const args = parseArgs(argv.slice(1));

switch (command) {
  case 'start': commandStart(args);  break;
  case 'help':  commandHelp();       break;
  default:
    print(`❌  Unknown command: ${command}`);
    commandHelp();
    process.exit(1);
}
