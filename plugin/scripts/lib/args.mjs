export function parseArgs(argv, { multi = [] } = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    let key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    let val;
    if (eq !== -1) val = a.slice(eq + 1);
    else if (key.startsWith("no-")) {
      key = key.slice(3);
      val = false;
    } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) val = argv[++i];
    else val = true;
    if (multi.includes(key)) (out[key] ||= []).push(val);
    else out[key] = val;
  }
  return out;
}

export function fail(message, code = 1) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(code);
}

export function list(value) {
  if (value === undefined || value === true) return [];
  return Array.isArray(value) ? value.flatMap(list) : String(value).split(",").map((s) => s.trim()).filter(Boolean);
}
