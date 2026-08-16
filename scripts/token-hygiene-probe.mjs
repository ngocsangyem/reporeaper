/**
 * Token-hygiene probe (child process).
 *
 * Loads one module with sentinel tokens in the environment and exercises it,
 * then writes its findings to a JSON report file. Findings go to a file rather
 * than stdout because a module that writes without a trailing newline would
 * otherwise splice itself onto a report line and hide it from the parent.
 *
 * A finding records where a sentinel surfaced and which variable it came from —
 * never the value itself.
 *
 * Usage: node token-hygiene-probe.mjs <module-path> <report-path> <sentinels-json>
 */
import { writeFileSync } from 'node:fs';
import { inspect } from 'node:util';

const [, , modulePath, reportPath, sentinelsJson] = process.argv;

if (!modulePath || !reportPath || !sentinelsJson) {
  process.stderr.write('probe: expected <module-path> <report-path> <sentinels-json>\n');
  process.exit(2);
}

/** Map of environment variable name -> sentinel value planted in it. */
const sentinels = JSON.parse(sentinelsJson);
const findings = [];

/** Records a leak by location and source variable, never by value. */
function record(where, envVar) {
  if (!findings.some((f) => f.where === where && f.envVar === envVar)) {
    findings.push({ where, envVar });
  }
}

/** Returns the sentinel variable names present in a string. */
function sentinelsIn(text) {
  return Object.entries(sentinels)
    .filter(([, value]) => text.includes(value))
    .map(([envVar]) => envVar);
}

/**
 * Scans every string form a value can reach a log or a wire through.
 *
 * util.inspect matters most: it is what console.log, console.error, and Node's
 * uncaught-exception printer actually use, and it walks private/non-enumerable
 * state that String() and JSON.stringify() cannot see. A token wrapper whose
 * toString/toJSON return "[redacted]" still leaks through inspect, so omitting
 * it would certify exactly the design this project relies on as safe.
 */
function scan(value, where) {
  const forms = [];
  try {
    forms.push(String(value));
  } catch {
    /* a value that refuses stringification cannot leak this way */
  }
  try {
    forms.push(JSON.stringify(value) ?? '');
  } catch {
    /* circular or non-serializable: the other forms still apply */
  }
  try {
    forms.push(inspect(value, { depth: 8, showHidden: true, getters: false }));
  } catch {
    /* inspect throwing is itself not a leak */
  }
  if (value instanceof Error && value.stack) forms.push(value.stack);

  for (const form of forms) {
    for (const envVar of sentinelsIn(form)) record(where, envVar);
  }
}

/** Writes the report; runs on every exit path so a crash still reports. */
function writeReport() {
  writeFileSync(reportPath, JSON.stringify({ completed: true, findings }));
}

try {
  const mod = await import(modulePath);

  // Exercise a request handler if the module exposes one (the serverless entry).
  if (typeof mod.default === 'function') {
    try {
      const response = await mod.default(new Request('https://example.invalid/api/me'));
      if (response instanceof Response) {
        const body = await response.clone().text();
        for (const envVar of sentinelsIn(body)) record('response body', envVar);
        for (const [name, value] of response.headers) {
          for (const envVar of sentinelsIn(value)) record(`response header ${name}`, envVar);
        }
      }
    } catch (error) {
      scan(error, 'thrown error');
    }
  }

  // Exported values must not carry a readable token either.
  for (const [name, value] of Object.entries(mod)) {
    if (name === 'default') continue;
    scan(value, `export ${name}`);
  }

  writeReport();
} catch (error) {
  scan(error, 'module load error');
  writeReport();
  process.exit(1);
}
