/**
 * Token-hygiene probe (child process).
 *
 * Loads one module with a sentinel token in the environment and exercises it.
 * Anything the module writes to stdout/stderr is captured by the parent, which
 * scans it for the sentinel. Values that never reach the streams — a returned
 * HTTP response body, a thrown error's serialization — are checked here and
 * reported as a location only, so the probe itself never echoes the secret.
 *
 * Usage: node token-hygiene-probe.mjs <module-path> <sentinel>
 */
const [, , modulePath, sentinel] = process.argv;

if (!modulePath || !sentinel) {
  process.stderr.write('probe: expected <module-path> <sentinel>\n');
  process.exit(2);
}

/** Reports a leak by location, never by content. */
function reportLeak(where) {
  process.stdout.write(`LEAK ${where}\n`);
}

/** Scans a value's string forms for the sentinel without printing them. */
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
    /* circular or non-serializable: the String() form above still applies */
  }
  if (value instanceof Error && value.stack) forms.push(value.stack);
  if (forms.some((form) => form.includes(sentinel))) reportLeak(where);
}

const mod = await import(modulePath);

// Exercise a request handler if the module exposes one (the serverless entry).
if (typeof mod.default === 'function') {
  try {
    const response = await mod.default(new Request('https://example.invalid/api/me'));
    if (response instanceof Response) {
      const body = await response.clone().text();
      if (body.includes(sentinel)) reportLeak('response body');
      for (const [name, value] of response.headers) {
        if (value.includes(sentinel)) reportLeak(`response header ${name}`);
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

process.stdout.write('PROBE_OK\n');
