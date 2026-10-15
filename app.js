(() => {
'use strict';
const $ = id => document.getElementById(id);
const code = $('code'), consoleEl = $('console');
const DEFAULT_SCRIPT = code.value;
const MAX_OPS = 200000;
let vars = Object.create(null), currentName = 'untitled.m';
let plots = [], octavePlot = null, holdOn = false;
let plotsMeta = { title: '', xlabel: 'x', ylabel: 'y' };
let ops = 0, running = false, lastEngine = 'browser';
let googleIdentityPromise = null, googleInitialized = false;

const examples = {
  basic: '% Basic arithmetic and common functions\na = 12;\nb = 5;\nsumValue = a + b;\nproductValue = a * b;\nrootValue = sqrt(144);\ndisp(sumValue);\ndisp(productValue);\ndisp(rootValue);',
  matrix: '% Matrix calculations\nA = [1 2; 3 4];\nb = [5; 6];\nC = A * b;\ndisp(C);\ndisp(det(A));',
  plot: '% Plot a sine curve\nx = 0:0.1:2*pi;\ny = sin(x);\nplot(x,y);\ntitle("Sine wave");\nxlabel("x");\nylabel("sin(x)");',
  loop: '% Sum integers from 1 to 10\ntotal = 0;\nfor k = 1:10\n total = total + k;\nend\ndisp(total);',
  arrays: '% Vectorization and element-wise operations (GNU Octave recommended)\nx = 1:5;\ny = x.^2;\nz = 2.*x + 1;\ndisp(x);\ndisp(y);\ndisp(z);\ndisp(sum(y));',
  logical: '% Logical indexing and comparisons (GNU Octave recommended)\nx = -5:5;\nmask = (x >= 0) & (mod(x,2) == 0);\nselected = x(mask);\ndisp(selected);',
  statistics: '% Statistics and matrix operations (GNU Octave recommended)\nA = [2 4 6; 1 3 5; 7 8 9];\ndisp(mean(A));\ndisp(std(A));\ndisp(sum(A,1));\ndisp(det(A));',
  function: '% User-defined function in a script (GNU Octave recommended)\nfunction y = parabola(x)\n  y = x.^2 - 4.*x + 3;\nendfunction\nx = -1:0.1:5;\ny = parabola(x);\nplot(x,y);\ntitle(\'Parabola\');\nxlabel(\'x\');\nylabel(\'y\');',
  numerical: '% Numerical root finding (GNU Octave recommended)\nf = @(x) x.^3 - 2.*x - 5;\nroot = fzero(f, 2);\nfprintf(\'Root = %.8f\\n\', root);',
  ode: '% Solve a differential equation (GNU Octave recommended)\nf = @(t,y) -2.*y;\n[t,y] = ode45(f, [0 5], 1);\nplot(t,y);\ntitle(\'dy/dt = -2y\');\nxlabel(\'Time\');\nylabel(\'y(t)\');',
  surface: '% 3-D surface plot (GNU Octave recommended)\n[X,Y] = meshgrid(-2:0.1:2, -2:0.1:2);\nZ = sin(sqrt(X.^2 + Y.^2));\nsurf(X,Y,Z);\ntitle(\'3-D surface\');\nxlabel(\'X\');\nylabel(\'Y\');\nzlabel(\'Z\');',
  complex: '% Complex numbers (GNU Octave recommended)\nz = 3 + 4i;\ndisp(abs(z));\ndisp(angle(z));\ndisp(real(z));\ndisp(imag(z));'
};

/* ------------------------------------------------------------------ UI helpers */
function updateLineNumbers() {
  const n = code.value.split('\n').length;
  $('lineNums').textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
}
function log(s, cls = '') {
  const d = document.createElement('div');
  d.className = cls; d.textContent = s === '' ? '\u00a0' : s;
  consoleEl.appendChild(d); consoleEl.scrollTop = consoleEl.scrollHeight;
}
function resetConsole() { consoleEl.innerHTML = ''; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* --------------------------------------------------------------- value helpers */
// Scalars are numbers/strings, row vectors are 1-D arrays, matrices are arrays of rows.
const COLON = Symbol('colon');
const isM = x => Array.isArray(x) && x.length > 0 && Array.isArray(x[0]);
const shape = x => isM(x) ? [x.length, x[0].length] : Array.isArray(x) ? [x.length ? 1 : 0, x.length] : typeof x === 'string' ? [1, x.length] : [1, 1];
const flatten = a => Array.isArray(a) ? a.flat(Infinity) : [a];
const map = (a, f) => Array.isArray(a) ? a.map(x => map(x, f)) : f(a);
const asM = v => isM(v) ? v : [Array.isArray(v) ? v : [v]];
const simplify = M => M.length === 0 ? [] : M.length === 1 ? (M[0].length === 1 ? M[0][0] : M[0]) : M;
const colMajor = v => isM(v) ? v[0].map((_, j) => v.map(r => r[j])).flat() : flatten(v);
const sc = x => { const v = Array.isArray(x) ? flatten(x)[0] : x; return typeof v === 'number' ? v : NaN; };
const truthy = v => { const f = flatten(v); return f.length > 0 && f.every(x => x !== 0 && x !== '' && x !== false); };
function transposeV(v) {
  if (typeof v === 'string') return v;
  const M = asM(v); if (!M[0].length) return [];
  return simplify(M[0].map((_, i) => M.map(r => r[i])));
}
function zip(a, b, f, name = 'operator') {
  const A = Array.isArray(a), B = Array.isArray(b);
  if (!A && !B) return f(a, b);
  if (A && !B) return map(a, x => f(x, b));
  if (!A && B) return map(b, y => f(a, y));
  const sa = shape(a), sb = shape(b);
  if (sa[0] !== sb[0] || sa[1] !== sb[1]) throw Error(`${name}: nonconformant arguments (op1 is ${sa.join('x')}, op2 is ${sb.join('x')})`);
  return isM(a) ? a.map((r, i) => r.map((x, j) => f(x, b[i][j]))) : a.map((x, i) => f(x, b[i]));
}
function mul(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return zip(a, b, (x, y) => x * y);
  if (!a.length || !b.length) throw Error('operator *: empty operands are not supported');
  const A = asM(a), B = asM(b);
  if (A[0].length !== B.length) throw Error(`operator *: nonconformant arguments (op1 is ${A.length}x${A[0].length}, op2 is ${B.length}x${B[0].length})`);
  return simplify(A.map(row => B[0].map((_, j) => row.reduce((s, x, k) => s + x * B[k][j], 0))));
}
function mpow(a, b) {
  if (!Array.isArray(a) && !Array.isArray(b)) return Math.pow(a, b);
  if (isM(a) && a.length === a[0].length && !Array.isArray(b) && Number.isInteger(b) && b >= 0 && b <= 64) {
    let r = a.map((row, i) => row.map((_, j) => i === j ? 1 : 0));
    for (let k = 0; k < b; k++) r = mul(r, a);
    return r;
  }
  throw Error('for x^y, only square matrix arguments with a non-negative integer power are supported; use .^ for element-wise power');
}

function leftDivide(a, b) {
  if (!Array.isArray(a)) {
    if (Array.isArray(b)) return map(b, y => y / a);
    return b / a;
  }
  const A = asM(a).map(row => row.slice());
  const B0 = asM(b);
  const m = A.length, n = A[0]?.length || 0;
  if (!n || A.some(row => row.length !== n)) throw Error('operator \\: invalid coefficient matrix');
  if (B0.length !== m) throw Error(`operator \\: nonconformant arguments (A is ${m}x${n}, B has ${B0.length} rows)`);
  if (!B0.length || B0.some(row => row.length !== B0[0].length)) throw Error('operator \\: invalid right-hand-side matrix');
  // Browser engine supports square systems only. Use partial pivoting for stability.
  if (m !== n) throw Error('operator \\: browser engine currently supports square systems only; use GNU Octave for rectangular systems');
  const B = B0.map(row => row.slice());
  const p = B[0].length;
  const scale = Math.max(1, ...A.flat().map(Math.abs));
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(A[i][k]) > Math.abs(A[pivot][k])) pivot = i;
    if (Math.abs(A[pivot][k]) <= Number.EPSILON * scale * n * 16) {
      throw Error('operator \\: matrix is singular to working precision');
    }
    if (pivot !== k) { [A[k], A[pivot]] = [A[pivot], A[k]]; [B[k], B[pivot]] = [B[pivot], B[k]]; }
    for (let i = k + 1; i < n; i++) {
      const factor = A[i][k] / A[k][k];
      A[i][k] = 0;
      for (let j = k + 1; j < n; j++) A[i][j] -= factor * A[k][j];
      for (let j = 0; j < p; j++) B[i][j] -= factor * B[k][j];
    }
  }
  const X = Array.from({length:n}, () => Array(p).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = 0; j < p; j++) {
      let value = B[i][j];
      for (let k = i + 1; k < n; k++) value -= A[i][k] * X[k][j];
      X[i][j] = value / A[i][i];
    }
  }
  return p === 1 ? X.map(row => row[0]) : X;
}

const cmpOp = f => (a, b) => zip(a, b, (x, y) => f(x, y) ? 1 : 0);
const BIN = {
  '+': (a, b) => zip(a, b, (x, y) => x + y, 'operator +'),
  '-': (a, b) => zip(a, b, (x, y) => x - y, 'operator -'),
  '.*': (a, b) => zip(a, b, (x, y) => x * y, 'product'),
  './': (a, b) => zip(a, b, (x, y) => x / y, 'quotient'),
  '.\\': (a, b) => zip(a, b, (x, y) => y / x, 'quotient'),
  '.^': (a, b) => zip(a, b, Math.pow, 'operator .^'),
  '*': mul,
  '/': (a, b) => { if (Array.isArray(b)) throw Error('matrix right division is not supported in the browser engine; use ./ for element-wise division'); return zip(a, b, (x, y) => x / y); },
  '\\': leftDivide,
  '^': mpow,
  '==': cmpOp((x, y) => x === y), '~=': cmpOp((x, y) => x !== y), '!=': cmpOp((x, y) => x !== y),
  '<': cmpOp((x, y) => x < y), '<=': cmpOp((x, y) => x <= y), '>': cmpOp((x, y) => x > y), '>=': cmpOp((x, y) => x >= y),
  '&': (a, b) => zip(a, b, (x, y) => (x !== 0 && y !== 0) ? 1 : 0),
  '|': (a, b) => zip(a, b, (x, y) => (x !== 0 || y !== 0) ? 1 : 0)
};
const CMP = new Set(['==', '~=', '!=', '<', '<=', '>', '>=']);
const MULOPS = new Set(['*', '/', '\\', '.*', './', '.\\']);

function fmtNum(v) {
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 'NaN' : v > 0 ? 'Inf' : '-Inf';
  return (Math.abs(v) < 1e-10 ? 0 : +v.toPrecision(8)).toString();
}
function fmt(v) {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    if (!v.length) return '[](0x0)';
    return isM(v) ? v.map(r => r.map(fmtNum).join('  ')).join('\n') : v.map(fmtNum).join('  ');
  }
  return fmtNum(v);
}
function show(name, v) { log(Array.isArray(v) ? `${name} =\n${fmt(v)}` : `${name} = ${fmt(v)}`); }

/* ------------------------------------------------------------------ tokenizer */
const NUM = /(?:\d+(?:\.(?![*\/\\^])\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const IDENT = /[A-Za-z_]\w*/y;
const OPS = /\.\*|\.\/|\.\\|\.\^|==|~=|!=|<=|>=|&&|\|\||[-+*\/\\^=(),;:\[\]<>&|~!]/y;
const tokCache = new Map();
function tokenize(s) {
  const hit = tokCache.get(s); if (hit) return hit;
  const out = [], stack = []; let i = 0, sp = false;
  const prevIsValue = () => { const l = out[out.length - 1]; return !!l && (l.t === 'num' || l.t === 'id' || (l.t === 'op' && (l.v === ')' || l.v === ']' || l.v === "'"))); };
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; sp = true; continue; }
    let tok;
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) { NUM.lastIndex = i; const m = NUM.exec(s); tok = { t: 'num', v: parseFloat(m[0]) }; i = NUM.lastIndex; }
    else if (/[A-Za-z_]/.test(c)) { IDENT.lastIndex = i; const m = IDENT.exec(s); tok = { t: 'id', v: m[0] }; i = IDENT.lastIndex; }
    else if (c === '"' || c === "'") {
      if (c === "'" && prevIsValue() && !(sp && stack[stack.length - 1] === '[')) { tok = { t: 'op', v: "'" }; i++; }
      else {
        let j = i + 1, str = '';
        for (;;) {
          if (j >= s.length) throw Error('Unterminated string');
          const d = s[j];
          if (d === c) { if (s[j + 1] === c) { str += c; j += 2; continue; } break; }
          if (c === '"' && d === '\\' && j + 1 < s.length) { const n = s[j + 1]; str += ({ n: '\n', t: '\t', '\\': '\\', '"': '"', "'": "'" })[n] ?? ('\\' + n); j += 2; continue; }
          str += d; j++;
        }
        tok = { t: 'str', v: str }; i = j + 1;
      }
    } else {
      OPS.lastIndex = i; const m = OPS.exec(s);
      if (!m) throw Error('Unsupported syntax near: ' + s.slice(i, i + 16));
      tok = { t: 'op', v: m[0] }; i = OPS.lastIndex;
      if (m[0] === '(' || m[0] === '[') stack.push(m[0]); else if (m[0] === ')' || m[0] === ']') stack.pop();
    }
    tok.sp = sp; sp = false; out.push(tok);
  }
  if (tokCache.size > 2000) tokCache.clear();
  tokCache.set(s, out); return out;
}

/* ------------------------------------------------------- indexing helpers */
function mkRange(a, s, b) {
  a = sc(a); s = sc(s); b = sc(b);
  if (![a, s, b].every(Number.isFinite)) throw Error('invalid range limits');
  if (s === 0 || (s > 0 && a > b) || (s < 0 && a < b)) return [];
  const n = Math.floor((b - a) / s + 1e-10) + 1;
  if (n > 1e6) throw Error('range is too large for the browser engine');
  return n === 1 ? a : Array.from({ length: n }, (_, i) => +(a + i * s).toPrecision(15));
}
function idxList(a, len) {
  const list = a === COLON ? Array.from({ length: len }, (_, i) => i + 1) : flatten(a);
  for (const i of list) {
    if (!Number.isInteger(i) || i < 1) throw Error(`subscript indices must be positive integers (got ${fmtNum(i)})`);
    if (i > len) throw Error(`index (${i}): out of bound ${len}`);
  }
  return list;
}
function indexGet(v, args) {
  if (typeof v === 'string') v = [...v].map(ch => ch.charCodeAt(0));
  if (args.length === 1) {
    const flat = colMajor(v), list = idxList(args[0], flat.length), res = list.map(i => flat[i - 1]);
    if (args[0] !== COLON && !Array.isArray(args[0])) return res[0];
    return (isM(v) && v[0].length === 1) || args[0] === COLON && isM(v) ? simplify(res.map(x => [x])) : simplify([res]);
  }
  if (args.length === 2) {
    const M = asM(v), rs = idxList(args[0], M.length), cs = idxList(args[1], M[0].length);
    return simplify(rs.map(r => cs.map(c => M[r - 1][c - 1])));
  }
  throw Error('only 1-D and 2-D indexing is supported in the browser engine');
}
function indexSet(name, args, val) {
  if (typeof val !== 'number') throw Error('only scalar values can be assigned to an indexed element in the browser engine');
  let cur = vars[name]; if (cur === undefined) cur = [];
  const posInt = i => typeof i === 'number' && Number.isInteger(i) && i >= 1;
  if (args.length === 1) {
    const i = args[0]; if (!posInt(i)) throw Error('index must be a positive integer');
    if (isM(cur)) {
      const r = cur.length, k = i - 1;
      if (k >= r * cur[0].length) throw Error('cannot grow a matrix with a single linear index');
      const M = cur.map(row => row.slice()); M[k % r][Math.floor(k / r)] = val; vars[name] = M;
    } else {
      const arr = Array.isArray(cur) ? cur.slice() : [cur];
      while (arr.length < i) arr.push(0);
      arr[i - 1] = val; vars[name] = arr.length === 1 ? arr[0] : arr;
    }
  } else if (args.length === 2) {
    const [i, j] = args; if (!posInt(i) || !posInt(j)) throw Error('indices must be positive integers');
    const M = (Array.isArray(cur) && cur.length ? asM(cur) : typeof cur === 'number' ? [[cur]] : []).map(row => row.slice());
    const w = Math.max(M.length ? M[0].length : 0, j);
    while (M.length < i) M.push([]);
    M.forEach(row => { while (row.length < w) row.push(0); });
    M[i - 1][j - 1] = val; vars[name] = simplify(M);
  } else throw Error('only 1-D and 2-D indexed assignment is supported in the browser engine');
}

/* ----------------------------------------------------- printf / num2str */
function sprintf(f, args) {
  const flat = args.flatMap(a => typeof a === 'string' ? [a] : flatten(a));
  const tpl = f.replace(/\\(n|t|r|\\|"|')/g, (_, c) => ({ n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'" })[c]);
  const specRe = /%(%|([-+ 0#]*)(\d+)?(?:\.(\d+))?([diufeEgGsc]))/g;
  const nSpecs = (tpl.match(specRe) || []).filter(s => s !== '%%').length;
  let k = 0, out = '';
  const one = () => tpl.replace(specRe, (m, all, flags, width, prec, conv) => {
    if (all === '%') return '%';
    if (k >= flat.length && flat.length) return '';
    const v = flat[k++]; let s;
    if (conv === 's' || conv === 'c') s = typeof v === 'number' ? (conv === 'c' ? String.fromCharCode(v) : fmtNum(v)) : String(v ?? '');
    else if (typeof v === 'string') s = v;
    else if (v === undefined) s = '';
    else if (!Number.isFinite(v)) s = fmtNum(v);
    else if ('diu'.includes(conv)) s = Number.isInteger(v) ? String(v) : String(+v.toPrecision(prec ? +prec : 5));
    else if (conv === 'f') s = v.toFixed(prec === undefined ? 6 : +prec);
    else if (conv === 'e' || conv === 'E') { s = v.toExponential(prec === undefined ? 6 : +prec).replace(/e([+-])(\d)$/, 'e$10$2'); if (conv === 'E') s = s.toUpperCase(); }
    else s = String(+v.toPrecision(prec === undefined ? 6 : Math.max(1, +prec)));
    if (flags.includes('+') && typeof v === 'number' && v >= 0 && 'dieEfgGu'.includes(conv)) s = '+' + s;
    if (width && s.length < +width) s = flags.includes('-') ? s.padEnd(+width) : (flags.includes('0') && typeof v === 'number') ? s.padStart(+width, '0') : s.padStart(+width);
    return s;
  });
  do { out += one(); } while (nSpecs > 0 && k < flat.length);
  return out;
}
function num2str(v) {
  if (typeof v === 'string') return v;
  const one = x => Number.isInteger(x) ? String(x) : !Number.isFinite(x) ? fmtNum(x) : String(+x.toPrecision(Math.max(Math.floor(Math.log10(Math.abs(x))) + 5, 5)));
  if (!Array.isArray(v)) return one(v);
  return isM(v) ? v.map(r => r.map(one).join('  ')).join('\n') : v.map(one).join('  ');
}

/* ------------------------------------------------------------- functions */
const MATH = Object.assign(Object.create(null), {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp,
  log: Math.log, log2: Math.log2, log10: Math.log10, floor: Math.floor, ceil: Math.ceil,
  round: x => Math.sign(x) * Math.round(Math.abs(x)), fix: Math.trunc, sign: Math.sign,
  real: x => x, imag: () => 0, conj: x => x
});
const CMDS = new Set(['clc', 'clear', 'clearvars', 'close', 'clf', 'figure', 'hold', 'grid', 'legend', 'axis', 'format', 'more', 'pkg', 'drawnow', 'subplot', 'xlim', 'ylim', 'box', 'colorbar', 'colormap', 'warning']);
const CONSTS = Object.assign(Object.create(null), { pi: Math.PI, e: Math.E, Inf: Infinity, inf: Infinity, NaN: NaN, nan: NaN, eps: 2.220446049250313e-16, true: 1, false: 0 });
function doCommand(w, rest) {
  rest = String(rest || '').trim().toLowerCase();
  if (w === 'clc') resetConsole();
  else if (w === 'clear' || w === 'clearvars') vars = Object.create(null);
  else if (w === 'hold') holdOn = rest === 'on' ? true : rest === 'off' ? false : !holdOn;
  else if (w === 'figure' || w === 'clf' || w === 'close') { plots = []; if (w === 'figure') holdOn = false; }
}
const needArr = (name, a, n = 1) => { if (a.length < n) throw Error(`Invalid call to ${name}`); return a; };
const reduceDim = (v, f) => !Array.isArray(v) ? f([v]) : isM(v) ? simplify([v[0].map((_, j) => f(v.map(r => r[j])))]) : f(v);
const fill = (name, a, val) => {
  const r = a.length ? sc(a[0]) : 1, c = a.length > 1 ? sc(a[1]) : r;
  if (![r, c].every(x => Number.isInteger(x) && x >= 0)) throw Error(`${name}: dimensions must be non-negative integers`);
  return r === 0 || c === 0 ? [] : simplify(Array.from({ length: r }, () => Array(c).fill(val)));
};
function detOf(a) {
  if (!Array.isArray(a)) return a;
  if (!isM(a) || a.length !== a[0].length) throw Error('det: A must be a square matrix');
  const n = a.length, M = a.map(r => r.slice()); let d = 1;
  if (n === 1) return M[0][0];
  if (n === 2) return M[0][0] * M[1][1] - M[0][1] * M[1][0];
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (M[p][c] === 0) return 0;
    if (p !== c) { [M[p], M[c]] = [M[c], M[p]]; d = -d; }
    d *= M[c][c];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k < n; k++) M[r][k] -= f * M[c][k]; }
  }
  return d;
}
const FUNCS = Object.create(null);
Object.assign(FUNCS, {
  disp: a => { needArr('disp', a); log(fmt(a[0])); },
  display: a => { needArr('display', a); log(fmt(a[0])); },
  fprintf: a => { if (typeof a[0] !== 'string' && typeof a[1] === 'string') a = a.slice(1); if (typeof a[0] !== 'string') { log(fmt(a[0])); return; } sprintf(a[0], a.slice(1)).split('\n').forEach((l, i, arr) => { if (i < arr.length - 1 || l) log(l); }); },
  sprintf: a => sprintf(String(needArr('sprintf', a)[0]), a.slice(1)),
  num2str: a => num2str(needArr('num2str', a)[0]),
  sum: a => reduceDim(needArr('sum', a)[0], v => v.reduce((s, x) => s + x, 0)),
  prod: a => reduceDim(needArr('prod', a)[0], v => v.reduce((s, x) => s * x, 1)),
  mean: a => reduceDim(needArr('mean', a)[0], v => v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN),
  min: a => a.length > 1 && a[1].length !== 0 ? zip(a[0], a[1], Math.min) : reduceDim(needArr('min', a)[0], v => v.length ? v.reduce((m, x) => x < m ? x : m, Infinity) : []),
  max: a => a.length > 1 && a[1].length !== 0 ? zip(a[0], a[1], Math.max) : reduceDim(needArr('max', a)[0], v => v.length ? v.reduce((m, x) => x > m ? x : m, -Infinity) : []),
  length: a => { const s = shape(needArr('length', a)[0]); return s[0] === 0 ? 0 : Math.max(...s); },
  numel: a => flatten(needArr('numel', a)[0]).length,
  isempty: a => shape(needArr('isempty', a)[0]).includes(0) ? 1 : 0,
  size: a => { const s = shape(needArr('size', a)[0]); return a.length > 1 ? s[sc(a[1]) - 1] ?? 1 : s; },
  zeros: a => fill('zeros', a, 0), ones: a => fill('ones', a, 1),
  eye: a => { const r = sc(needArr('eye', a)[0]), c = a.length > 1 ? sc(a[1]) : r; return simplify(Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => i === j ? 1 : 0))); },
  linspace: a => { const lo = sc(needArr('linspace', a, 2)[0]), hi = sc(a[1]), n = a.length > 2 ? sc(a[2]) : 100; return n < 2 ? hi : Array.from({ length: n }, (_, i) => i === n - 1 ? hi : lo + i * (hi - lo) / (n - 1)); },
  mod: a => zip(needArr('mod', a, 2)[0], a[1], (x, y) => y === 0 ? x : x - Math.floor(x / y) * y),
  rem: a => zip(needArr('rem', a, 2)[0], a[1], (x, y) => y === 0 ? x : x - Math.trunc(x / y) * y),
  atan2: a => zip(needArr('atan2', a, 2)[0], a[1], Math.atan2),
  transpose: a => transposeV(needArr('transpose', a)[0]),
  det: a => detOf(needArr('det', a)[0]),
  trace: a => { const m = needArr('trace', a)[0]; if (!Array.isArray(m)) return m; if (!isM(m) || m.length !== m[0].length) throw Error('trace: only valid on square matrix'); return m.reduce((s, r, i) => s + r[i], 0); },
  plot: a => {
    const nums = a.filter(x => typeof x !== 'string');
    if (!nums.length) throw Error('plot: invalid arguments');
    const series = [];
    if (nums.length === 1) { const y = flatten(nums[0]); series.push({ x: y.map((_, i) => i + 1), y }); }
    else for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = flatten(nums[i]), y = flatten(nums[i + 1]);
      if (x.length !== y.length) throw Error('plot: x and y must have the same number of elements');
      series.push({ x, y });
    }
    plots = holdOn ? plots.concat(series) : series; octavePlot = null; renderPlot();
  }
});
for (const k of ['title', 'xlabel', 'ylabel']) FUNCS[k] = a => { plotsMeta[k] = a.length ? fmt(a[0]) : ''; renderPlot(); };
function call(n, a) {
  if (CMDS.has(n)) { doCommand(n, typeof a[0] === 'string' ? a[0] : ''); return undefined; }
  if (n in MATH) return map(needArr(n, a)[0], MATH[n]);
  if (FUNCS[n]) return FUNCS[n](a);
  throw Error(`Unknown function: ${n} (the browser engine supports a subset; run SMAT through the local server to use GNU Octave)`);
}

/* ------------------------------------------------------------------- parser */
function parseExpr(src, scope, endCtx) {
  const t = tokenize(src); let p = 0, inMat = false; const endStack = endCtx ? [endCtx] : [];
  const op = () => (t[p] && t[p].t === 'op') ? t[p].v : undefined;
  const expect = v => { if (op() !== v) throw Error(`Expected ${v}`); p++; };
  const not = v => map(v, x => x === 0 ? 1 : 0);
  function lor() { let a = land(); while (op() === '||') { p++; const b = land(); a = (truthy(a) || truthy(b)) ? 1 : 0; } return a; }
  function land() { let a = eor(); while (op() === '&&') { p++; const b = eor(); a = (truthy(a) && truthy(b)) ? 1 : 0; } return a; }
  function eor() { let a = eand(); while (op() === '|') { p++; a = BIN['|'](a, eand()); } return a; }
  function eand() { let a = comp(); while (op() === '&') { p++; a = BIN['&'](a, comp()); } return a; }
  function comp() { let a = range(); while (CMP.has(op())) { const o = t[p++].v; a = BIN[o](a, range()); } return a; }
  function range() {
    const a = add();
    if (op() === ':') { p++; const b = add(); if (op() === ':') { p++; return mkRange(a, b, add()); } return mkRange(a, 1, b); }
    return a;
  }
  function add() {
    let a = mulL();
    for (;;) {
      const o = op(); if (o !== '+' && o !== '-') break;
      if (inMat && t[p].sp && t[p + 1] && !t[p + 1].sp) break;   // [1 -2] is two elements
      p++; a = BIN[o](a, mulL());
    }
    return a;
  }
  function mulL() { let a = unary(); while (MULOPS.has(op())) { const o = t[p++].v; a = BIN[o](a, unary()); } return a; }
  function unary() {
    const o = op();
    if (o === '-' || o === '+' || o === '!' || o === '~') { p++; const v = unary(); return o === '-' ? map(v, x => -x) : o === '+' ? v : not(v); }
    return power();
  }
  function power() { let a = postfix(); while (op() === '^' || op() === '.^') { const o = t[p++].v; a = BIN[o](a, powOperand()); } return a; }
  function powOperand() {
    const o = op();
    if (o === '-' || o === '+' || o === '!' || o === '~') { p++; const v = powOperand(); return o === '-' ? map(v, x => -x) : o === '+' ? v : not(v); }
    return postfix();
  }
  function postfix() { let a = primary(); while (op() === "'") { p++; a = transposeV(a); } return a; }
  function countArgs() {          // number of top-level arguments of the call whose '(' was just consumed
    let d = 0, n = 1, i = p; if (t[i] && t[i].t === 'op' && t[i].v === ')') return 0;
    for (; i < t.length; i++) {
      if (t[i].t !== 'op') continue;
      const v = t[i].v;
      if (v === '(' || v === '[') d++; else if (v === ')' || v === ']') { if (d === 0) break; d--; } else if (v === ',' && d === 0) n++;
    }
    return n;
  }
  function primary() {
    const q = t[p++]; if (!q) throw Error('Expected an expression');
    if (q.t === 'num' || q.t === 'str') return q.v;
    if (q.t === 'op') {
      if (q.v === '(') { const s = inMat; inMat = false; const v = lor(); inMat = s; expect(')'); return v; }
      if (q.v === '[') {
        const s = inMat; inMat = true; const rows = []; let row = [];
        const flush = () => { if (!row.length) return; rows.push(row.every(x => typeof x === 'string') ? row.join('') : hcat(row)); row = []; };
        while (p < t.length && op() !== ']') {
          if (op() === ';') { p++; flush(); continue; }
          if (op() === ',') { p++; continue; }
          row.push(lor());
        }
        inMat = s; expect(']'); flush();
        if (!rows.length) return [];
        if (rows.length === 1) return typeof rows[0] === 'string' ? rows[0] : simplify(rows[0]);
        if (rows.some(r => typeof r === 'string')) throw Error('vertical concatenation of strings is not supported');
        return simplify(vcat(rows));
      }
      throw Error('Unexpected token ' + q.v);
    }
    const name = q.v;
    if (op() === '(' && !(inMat && t[p].sp)) {
      p++; const s = inMat; inMat = false;
      const isVar = name in scope, n = countArgs(), args = [];
      for (let k = 0; k < n; k++) {
        if (op() === ':' && t[p + 1] && t[p + 1].t === 'op' && (t[p + 1].v === ',' || t[p + 1].v === ')')) { p++; args.push(COLON); }
        else {
          if (isVar) endStack.push({ v: scope[name], k, n });
          try { args.push(lor()); } finally { if (isVar) endStack.pop(); }
        }
        if (k < n - 1) expect(',');
      }
      expect(')'); inMat = s;
      return isVar ? indexGet(scope[name], args) : call(name, args);
    }
    if (name === 'end' && endStack.length) {
      const c = endStack[endStack.length - 1], s = shape(c.v);
      return c.n === 1 ? s[0] * s[1] : c.k === 0 ? s[0] : s[1];
    }
    if (name in scope) return scope[name];
    if (name in CONSTS) return CONSTS[name];
    if (CMDS.has(name) || name in MATH || FUNCS[name]) return call(name, []);
    throw Error('Undefined variable: ' + name);
  }
  function hcat(items) {
    const ms = items.map(asM), r = ms[0].length;
    if (ms.some(m => m.length !== r)) throw Error('horizontal dimensions mismatch');
    return Array.from({ length: r }, (_, i) => ms.flatMap(m => m[i]));
  }
  function vcat(ms) {
    const w = ms[0][0].length;
    if (ms.some(m => m[0].length !== w)) throw Error('Matrix rows must have equal lengths');
    return ms.flat();
  }
  const v = lor();
  if (p < t.length) throw Error('Unexpected token ' + t[p].v);
  return v;
}
const evalExpr = (src, endCtx) => parseExpr(src, vars, endCtx);

/* ------------------------------------------------- statements & control flow */
function eachCode(s, fn) {      // visit characters outside string literals; stop when fn returns true
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\' && q === '"') { i++; continue; } if (c === q) { if (s[i + 1] === q) { i++; continue; } q = null; } continue; }
    if (c === '"') { q = c; continue; }
    if (c === "'") { if (i > 0 && /[\w)\]'.]/.test(s[i - 1])) continue; q = c; continue; }
    if (fn(c, i) === true) return i;
  }
  return -1;
}
function stripComment(s) { const i = eachCode(s, c => c === '%' || c === '#'); return i < 0 ? s : s.slice(0, i); }
function openBrackets(s) { const st = []; eachCode(s, c => { if ('([{'.includes(c)) st.push(c); else if (')]}'.includes(c)) st.pop(); }); return st; }
function splitLine(s) {
  const out = []; let depth = 0, start = 0;
  eachCode(s, (c, i) => {
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && (c === ';' || c === ',')) { out.push({ text: s.slice(start, i).trim(), suppress: c === ';' }); start = i + 1; }
  });
  out.push({ text: s.slice(start).trim(), suppress: false });
  return out.filter(x => x.text);
}
function unwrap(s) {
  if (s[0] !== '(') return s;
  let d = 0; const end = eachCode(s, c => { if (c === '(') d++; else if (c === ')') { d--; if (d === 0) return true; } });
  return end === s.length - 1 ? s.slice(1, -1).trim() : s;
}
const wordOf = t => (t.match(/^[A-Za-z_]\w*/) || [''])[0];
const ENDS = new Set(['end', 'endfor', 'endwhile', 'endif']);
const UNSUPPORTED = new Set(['function', 'endfunction', 'switch', 'case', 'otherwise', 'endswitch', 'try', 'catch', 'end_try_catch', 'do', 'until', 'unwind_protect', 'parfor', 'global', 'persistent', 'return']);

function parseProgram(src) {
  const stmts = []; let acc = '', startLine = 1;
  src.split(/\r?\n/).forEach((raw, idx) => {
    if (!acc) startLine = idx + 1;
    const s = stripComment(raw);
    if (/\.\.\.\s*$/.test(s)) { acc += s.replace(/\.\.\.\s*$/, ' '); return; }
    acc += s;
    const open = openBrackets(acc);
    if (open.length) { acc += open[open.length - 1] === '[' ? '; ' : ' '; return; }
    for (const st of splitLine(acc)) stmts.push({ ...st, line: startLine });
    acc = '';
  });
  if (acc.trim()) { if (openBrackets(acc).length) throw Error('Unbalanced brackets at end of script'); for (const st of splitLine(acc)) stmts.push({ ...st, line: startLine }); }
  let i = 0;
  const lineErr = (s, msg) => { const e = Error(msg); e.line = s.line; return e; };
  function block(stop, owner) {
    const nodes = [];
    while (i < stmts.length) {
      const s = stmts[i], w = wordOf(s.text);
      if (stop.includes(w)) return nodes;
      if (ENDS.has(w) || w === 'else' || w === 'elseif') throw lineErr(s, `Unexpected '${w}'`);
      if (UNSUPPORTED.has(w) && !/^\w+\s*=(?!=)/.test(s.text)) throw lineErr(s, `'${w}' is not supported in the browser engine; run SMAT through the local server to use GNU Octave`);
      if (w === 'for' && /^for[\s(]/.test(s.text)) {
        i++; const rest = unwrap(s.text.slice(3).trim()), m = rest.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
        if (!m) throw lineErr(s, 'Invalid for loop header');
        const body = block(['end', 'endfor'], s); i++;
        nodes.push({ k: 'for', v: m[1], expr: m[2], body, line: s.line });
      } else if (w === 'while' && /^while[\s(]/.test(s.text)) {
        i++; const cond = s.text.slice(5).trim(); if (!cond) throw lineErr(s, 'Invalid while loop header');
        const body = block(['end', 'endwhile'], s); i++;
        nodes.push({ k: 'while', cond, body, line: s.line });
      } else if (w === 'if' && /^if[\s(]/.test(s.text)) {
        const node = { k: 'if', branches: [], otherwise: null, line: s.line };
        let head = s;
        for (;;) {
          i++; const cond = head.text.slice(head.text.startsWith('elseif') ? 6 : 2).trim();
          if (!cond) throw lineErr(head, 'Missing condition');
          node.branches.push({ cond, body: block(['elseif', 'else', 'end', 'endif'], s), line: head.line });
          const tw = wordOf(stmts[i].text);
          if (tw === 'elseif') { head = stmts[i]; continue; }
          if (tw === 'else') { i++; node.otherwise = block(['end', 'endif'], s); }
          i++; break;
        }
        nodes.push(node);
      } else if (w === 'break' && s.text === 'break') { nodes.push({ k: 'break', line: s.line }); i++; }
      else if (w === 'continue' && s.text === 'continue') { nodes.push({ k: 'continue', line: s.line }); i++; }
      else { nodes.push({ k: 'stmt', text: s.text, suppress: s.suppress, line: s.line }); i++; }
    }
    if (stop.length) throw lineErr(owner, `Missing 'end' for '${wordOf(owner.text)}' that starts here`);
    return nodes;
  }
  return block([], null);
}
function tick() { if (++ops > MAX_OPS) throw Error(`Stopped after ${MAX_OPS.toLocaleString()} operations. The browser engine is not meant for heavy loops; use the GNU Octave engine.`); }
function forValues(r) {
  if (!Array.isArray(r)) return [r];
  if (isM(r)) return r[0].map((_, j) => simplify(r.map(row => [row[j]])));
  return r;
}
function execNodes(nodes) {
  for (const n of nodes) {
    try {
      tick();
      if (n.k === 'stmt') runStatement(n.text, n.suppress);
      else if (n.k === 'break' || n.k === 'continue') return n.k;
      else if (n.k === 'for') {
        for (const v of forValues(evalExpr(n.expr))) { tick(); vars[n.v] = v; const r = execNodes(n.body); if (r === 'break') break; }
      } else if (n.k === 'while') {
        while (truthy(evalExpr(n.cond))) { tick(); const r = execNodes(n.body); if (r === 'break') break; }
      } else if (n.k === 'if') {
        let ran = false;
        for (const b of n.branches) if (truthy(evalExpr(b.cond))) { ran = true; const r = execNodes(b.body); if (r) return r; break; }
        if (!ran && n.otherwise) { const r = execNodes(n.otherwise); if (r) return r; }
      }
    } catch (e) { if (e && e.line === undefined) e.line = n.line; throw e; }
  }
}
function runStatement(text, suppress) {
  let m;
  const w = wordOf(text);
  if (CMDS.has(w) && /^[A-Za-z_]\w*(\s+[\w.-]+)*$/.test(text)) { doCommand(w, text.slice(w.length)); return; }
  if ((m = text.match(/^([A-Za-z_]\w*)\s*([-+*\/])=(?!=)\s*(.+)$/))) {
    if (!(m[1] in vars)) throw Error('Undefined variable: ' + m[1]);
    vars[m[1]] = BIN[m[2]](vars[m[1]], evalExpr(m[3])); if (!suppress) show(m[1], vars[m[1]]); return;
  }
  if ((m = text.match(/^([A-Za-z_]\w*)\s*\((.*)\)\s*=(?!=)\s*(.+)$/)) && !CMDS.has(m[1])) {
    const name = m[1], parts = []; let depth = 0, start = 0;
    eachCode(m[2], (c, i) => { if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--; else if (c === ',' && depth === 0) { parts.push(m[2].slice(start, i)); start = i + 1; } });
    parts.push(m[2].slice(start));
    const cur = vars[name];
    const idx = parts.map((s, k) => evalExpr(s.trim(), { v: cur === undefined ? [] : cur, k, n: parts.length }));
    const val = evalExpr(m[3]);
    indexSet(name, idx, val);
    if (!suppress) show(name, vars[name]); return;
  }
  if ((m = text.match(/^([A-Za-z_]\w*)\s*=(?!=)\s*(.+)$/))) {
    const v = evalExpr(m[2]);
    if (v === undefined) throw Error('value on the right hand side of the assignment is not defined');
    vars[m[1]] = v; if (!suppress) show(m[1], v); return;
  }
  const v = evalExpr(text);
  if (v === undefined) return;
  const bare = /^[A-Za-z_]\w*$/.test(text);
  if (!bare) vars.ans = v;
  if (!suppress) show(bare ? text : 'ans', v);
}
function execute(src, fresh = true) {
  if (fresh) { vars = Object.create(null); plots = []; holdOn = false; octavePlot = null; plotsMeta = { title: '', xlabel: 'x', ylabel: 'y' }; }
  ops = 0;
  try {
    execNodes(parseProgram(src));
    updateVars(); renderPlot(); return true;
  } catch (e) {
    log('Error' + (e.line ? ` (line ${e.line})` : '') + ': ' + (e.message || e), 'error');
    log('Tip: this browser engine supports a practical subset of MATLAB-style syntax.', '');
    updateVars(); renderPlot(); return false;
  }
}

/* ------------------------------------------------------------- plotting */
const PALETTE = ['#159b7a', '#2f6fed', '#e0753a', '#9b59d0', '#d6455d'];
const emptyPlot = '<div class="emptyplot">⌁<p>Your plot will appear here</p><small>Try plot(x, sin(x)) or run the example.</small></div>';
const tickLabel = v => Math.abs(v) < 1e-12 ? '0' : String(+v.toPrecision(3));
function renderPlot() {
  const a = $('plotArea'), b = $('plotArea2');
  if (octavePlot) {
    for (const el of [a, b]) { const img = new Image(); img.src = 'data:image/png;base64,' + octavePlot; img.alt = 'Octave-generated plot'; el.replaceChildren(img); }
    return;
  }
  const pts = plots.map(s => s.x.map((x, i) => [x, s.y[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
  const all = pts.flat();
  if (!all.length) { a.innerHTML = b.innerHTML = emptyPlot; return; }
  const W = 760, H = 300, pad = 48, padL = 70;
  let xmin = Math.min(...all.map(q => q[0])), xmax = Math.max(...all.map(q => q[0])), ymin = Math.min(...all.map(q => q[1])), ymax = Math.max(...all.map(q => q[1]));
  if (xmin === xmax) xmax = xmin + 1;
  if (ymin === ymax) { ymin -= 1; ymax += 1; }
  const X = x => padL + (x - xmin) / (xmax - xmin) * (W - padL - pad), Y = y => H - pad - (y - ymin) / (ymax - ymin) * (H - 2 * pad);
  let grid = '';
  for (let i = 0; i < 5; i++) {
    const y = pad + i * (H - 2 * pad) / 4, val = ymax - i * (ymax - ymin) / 4, x = padL + i * (W - padL - pad) / 4, xv = xmin + i * (xmax - xmin) / 4;
    grid += `<line x1="${padL}" y1="${y}" x2="${W - pad}" y2="${y}" stroke="#e3e8ed"/><text x="${padL - 8}" y="${y + 4}" text-anchor="end" class="plotLabel">${tickLabel(val)}</text>`;
    grid += `<text x="${x}" y="${H - pad + 16}" text-anchor="middle" class="plotLabel">${tickLabel(xv)}</text>`;
  }
  const lines = pts.map((s, k) => `<polyline fill="none" stroke="${PALETTE[k % PALETTE.length]}" stroke-width="2.5" stroke-linejoin="round" points="${s.map(([x, y]) => `${X(x).toFixed(2)},${Y(y).toFixed(2)}`).join(' ')}"/>`).join('');
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(plotsMeta.title || 'Data plot')}">${grid}<line x1="${padL}" y1="${pad}" x2="${padL}" y2="${H - pad}" stroke="#9aa5b1"/><line x1="${padL}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#9aa5b1"/>${lines}<text x="${(padL + W - pad) / 2}" y="22" text-anchor="middle" class="plotLabel">${esc(plotsMeta.title)}</text><text x="${(padL + W - pad) / 2}" y="${H - 6}" text-anchor="middle" class="plotLabel">${esc(plotsMeta.xlabel)}</text><text x="13" y="${H / 2}" transform="rotate(-90 13 ${H / 2})" text-anchor="middle" class="plotLabel">${esc(plotsMeta.ylabel)}</text></svg>`;
  a.innerHTML = b.innerHTML = svg;
}
function updateVars() {
  const el = $('variablesTable');
  if (lastEngine === 'octave') { el.textContent = 'Workspace variables are shown when scripts run in the browser engine. This script ran in GNU Octave; use disp() or whos to inspect values.'; return; }
  const entries = Object.entries(vars);
  el.innerHTML = entries.length
    ? '<table><thead><tr><th>Name</th><th>Size</th><th>Value preview</th></tr></thead><tbody>' + entries.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${shape(v).join(' × ')}</td><td>${esc(fmt(v).slice(0, 100))}</td></tr>`).join('') + '</tbody></table>'
    : 'No variables yet. Run a script first.';
}

/* ------------------------------------------------------------ run / files */
function setBusy(b) { $('runBtn').disabled = b; $('quickRun').disabled = b; }
async function run() {
  if (running) return;
  running = true; setBusy(true);
  try {
    resetConsole(); plots = []; octavePlot = null; renderPlot();
    log('Starting SMAT execution…');
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      let status = null;
      try { const probe = await fetch('/api/status', { cache: 'no-store' }); if (probe.ok) status = await probe.json(); } catch { /* no local bridge */ }
      if (status && status.octave === false) {
        log('GNU Octave was not found on this computer, so the built-in browser engine is being used. See README.md to install Octave.', 'error');
      } else if (status) {
        try {
          const r = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code.value }), signal: AbortSignal.timeout(45000) });
          const data = await r.json(); resetConsole(); lastEngine = 'octave';
          if (data.stdout) data.stdout.split(/\r?\n/).filter(Boolean).forEach(l => log(l, 'output'));
          if (data.stderr) data.stderr.split(/\r?\n/).filter(Boolean).forEach(l => log(l, 'error'));
          if (data.plot) { octavePlot = data.plot; renderPlot(); }
          if (data.ok) { log('✓ Executed with GNU Octave.', 'output'); $('engineStatus').textContent = 'GNU Octave engine'; }
          else { log('Execution failed. Review the Octave error above.', 'error'); $('engineStatus').textContent = 'Execution error'; }
          updateVars(); return;
        } catch (e) { resetConsole(); log('Could not use the Octave bridge (' + e.message + '). Falling back to the browser engine.', 'error'); }
      }
    }
    lastEngine = 'browser';
    if (execute(code.value)) { log('✓ Script finished successfully.', 'output'); $('engineStatus').textContent = 'Browser math engine ready'; }
    else $('engineStatus').textContent = 'Script reported an error';
  } finally { running = false; setBusy(false); }
}
function downloadTextFile(name, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name.endsWith('.m') ? name : name + '.m';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function downloadProgram() { downloadTextFile(currentName, code.value); }
async function saveScriptFile(name, text) {
  if (typeof window.showSaveFilePicker === 'function') {
    const handle = await window.showSaveFilePicker({
      suggestedName: name,
      types: [{ description: 'SMAT / MATLAB script', accept: { 'text/plain': ['.m'] } }]
    });
    const writable = await handle.createWritable();
    try { await writable.write(text); await writable.close(); }
    catch (err) { if (typeof writable.abort === 'function') await writable.abort().catch(() => {}); throw err; }
    return { name: handle.name || name, method: 'file' };
  }
  downloadTextFile(name, text);
  return { name, method: 'download' };
}
const SAVED_PROGRAMS_KEY = 'smatSavedPrograms';
function loadSavedPrograms() {
  try {
    const items = JSON.parse(localStorage.getItem(SAVED_PROGRAMS_KEY) || '[]');
    return Array.isArray(items) ? items.filter(x => x && typeof x.name === 'string' && typeof x.text === 'string') : [];
  } catch { return []; }
}
function drawSavedPrograms() {
  const box = $('savedPrograms'); box.replaceChildren();
  const items = loadSavedPrograms();
  if (!items.length) {
    const empty = document.createElement('div'); empty.className = 'savedEmpty';
    empty.textContent = 'No programs saved in this browser yet.'; box.appendChild(empty); return;
  }
  items.forEach(item => {
    const row = document.createElement('div'); row.className = 'savedRow';
    const load = document.createElement('button'); load.className = 'savedLoad';
    load.type = 'button'; load.textContent = '▤ ' + item.name;
    load.title = 'Open ' + item.name; load.onclick = () => { loadText(item.text, item.name); view('editor'); };
    const remove = document.createElement('button'); remove.className = 'savedDelete';
    remove.type = 'button'; remove.textContent = '×'; remove.title = 'Delete ' + item.name;
    remove.setAttribute('aria-label', 'Delete saved program ' + item.name);
    remove.onclick = () => {
      if (!confirm(`Delete saved program “${item.name}” from this browser?`)) return;
      try { localStorage.setItem(SAVED_PROGRAMS_KEY, JSON.stringify(loadSavedPrograms().filter(x => x.name !== item.name))); drawSavedPrograms(); }
      catch { log('Could not update saved programs in this browser.', 'error'); }
    };
    row.append(load, remove); box.appendChild(row);
  });
}
function openSaveDialog() {
  const dialog = $('saveDialog'), input = $('saveName');
  input.value = currentName.replace(/\.m$/i, '') || 'untitled';
  $('saveError').textContent = '';
  dialog.showModal(); input.focus(); input.select();
}
async function storeProgram(event) {
  event.preventDefault();
  const input = $('saveName');
  const base = input.value.trim().replace(/\.m$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 64) || 'untitled';
  const name = base + '.m';
  $('saveError').textContent = '';
  try {
    const result = await saveScriptFile(name, code.value);
    const savedName = result.name.toLowerCase().endsWith('.m') ? result.name : result.name + '.m';
    currentName = savedName; $('fileLabel').textContent = savedName;
    addRecent(savedName, code.value);
    const items = loadSavedPrograms();
    const next = [{ name: savedName, text: code.value, updatedAt: Date.now() }, ...items.filter(x => x.name.toLowerCase() !== savedName.toLowerCase())].slice(0, 50);
    let quickCopySaved = true;
    try { localStorage.setItem(SAVED_PROGRAMS_KEY, JSON.stringify(next)); } catch { quickCopySaved = false; }
    drawSavedPrograms(); $('saveDialog').close();
    if (result.method === 'file') log(`✓ Saved “${savedName}” to the location you chose on this device.`, 'output');
    else log(`✓ Downloaded “${savedName}”. Check your browser's Downloads folder; exact location depends on its download settings.`, 'output');
    if (!quickCopySaved) log('The file was saved, but the browser quick-reopen list could not be updated.', 'error');
  } catch (err) {
    $('saveError').textContent = err && err.name === 'AbortError' ? 'Save cancelled; no file was written.' : 'Could not save the file. ' + (err && err.message ? err.message : 'Please try again or use Export.');
  }
}
function loadRecent() {
  try { const a = JSON.parse(localStorage.getItem('smatRecent') || '[]'); return Array.isArray(a) ? a.filter(x => x && typeof x.name === 'string' && typeof x.text === 'string') : []; }
  catch { return []; }
}
function addRecent(name, text) {
  let arr = loadRecent().filter(x => x.name !== name); arr.unshift({ name, text }); arr = arr.slice(0, 8);
  try { localStorage.setItem('smatRecent', JSON.stringify(arr)); } catch { /* storage unavailable or full */ }
  drawRecent();
}
function drawRecent() {
  const box = $('recent'); box.innerHTML = '';
  loadRecent().forEach(x => { const b = document.createElement('button'); b.textContent = '▤ ' + x.name; b.onclick = () => loadText(x.text, x.name); box.appendChild(b); });
}
function loadText(text, name) {
  code.value = text; currentName = name || 'untitled.m';
  $('fileLabel').textContent = currentName; updateLineNumbers(); addRecent(currentName, text);
}
function loadGoogleIdentityServices() {
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
  if (!googleIdentityPromise) googleIdentityPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.defer = true;
    script.onload = resolve; script.onerror = () => reject(Error('Could not load Google Identity Services. Check your internet connection.'));
    document.head.appendChild(script);
  });
  return googleIdentityPromise;
}
function decodeGoogleCredential(token) {
  const part = String(token).split('.')[1];
  if (!part) throw Error('Google returned an invalid profile credential.');
  const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}
function handleGoogleCredential(response) {
  try {
    const clientId = String(window.SMAT_GOOGLE_CLIENT_ID || '').trim();
    const claims = decodeGoogleCredential(response && response.credential);
    const issuers = ['accounts.google.com', 'https://accounts.google.com'];
    if (!clientId || claims.aud !== clientId || !issuers.includes(claims.iss) || !claims.sub || !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000) throw Error('The Google profile credential did not match this client or has expired. Check the client ID and authorized origin.');
    $('profileName').textContent = claims.name || claims.given_name || 'Google user';
    $('profileEmail').textContent = claims.email || '';
    const photo = $('profileAvatar'); let photoURL = '';
    try { const u = new URL(claims.picture); if (u.protocol === 'https:' && u.hostname.endsWith('googleusercontent.com')) photoURL = u.href; } catch { /* profile photo is optional */ }
    photo.hidden = !photoURL;
    if (photoURL) photo.src = photoURL; else photo.removeAttribute('src');
    $('profileSignedOut').hidden = true; $('profileSignedIn').hidden = false;
  } catch (err) { $('googleAuthStatus').textContent = err.message || 'Could not read the Google profile. Verify your OAuth client setup.'; }
}
async function startGoogleProfile() {
  const clientId = String(window.SMAT_GOOGLE_CLIENT_ID || '').trim();
  const status = $('googleAuthStatus');
  if (!clientId) { status.textContent = 'Setup needed: add your Google Web client ID to google-auth-config.js and authorize this site origin.'; return; }
  if (!clientId.endsWith('.apps.googleusercontent.com')) { status.textContent = 'The configured value does not look like a Google Web client ID.'; return; }
  try {
    await loadGoogleIdentityServices();
    if (!googleInitialized) {
      window.google.accounts.id.initialize({ client_id: clientId, callback: handleGoogleCredential, auto_select: false });
      googleInitialized = true;
    }
    const mount = $('googleAuthButton');
    if (mount.dataset.rendered !== 'true') {
      window.google.accounts.id.renderButton(mount, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', logo_alignment: 'left', width: 280 });
      mount.dataset.rendered = 'true';
    }
    status.textContent = 'Continue with Google to show your profile in this tab.';
  } catch (err) { status.textContent = err.message || 'Google sign-in could not be loaded.'; }
}
function signOutGoogleProfile() {
  if (window.google && window.google.accounts && window.google.accounts.id) window.google.accounts.id.disableAutoSelect();
  $('profileSignedIn').hidden = true; $('profileSignedOut').hidden = false;
  $('googleAuthStatus').textContent = 'Signed out of SMAT. Your Google account may remain signed in to Google in this browser.';
}
function view(v) {
  document.querySelectorAll('.nav').forEach(n => n.classList.toggle('active', n.dataset.view === v));
  $('editorView').classList.toggle('hidden', v !== 'editor'); $('plotPanel').classList.toggle('hidden', v !== 'editor');
  ['variables', 'plots', 'help', 'profile'].forEach(k => $(k + 'View').classList.toggle('hidden', v !== k));
  if (v === 'variables') updateVars();
  if (v === 'plots') renderPlot();
  if (v === 'profile') startGoogleProfile();
  if (innerWidth < 651) $('sidebar').classList.remove('open');
}
function runCommandLine() {
  const input = $('command'), s = input.value;
  if (!s.trim()) return;
  log('» ' + s); lastEngine = 'browser';
  execute(s, false);
  input.value = '';
}

/* ------------------------------------------------------------- wiring */
code.addEventListener('input', updateLineNumbers);
code.addEventListener('keydown', e => {
  if (e.key === 'Tab') { e.preventDefault(); code.setRangeText('    ', code.selectionStart, code.selectionEnd, 'end'); updateLineNumbers(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
});
$('runBtn').addEventListener('click', run);
$('quickRun').addEventListener('click', run);
$('saveBtn').addEventListener('click', openSaveDialog);
$('downloadBtn').addEventListener('click', downloadProgram);
$('saveForm').addEventListener('submit', storeProgram);
$('cancelSave').addEventListener('click', () => $('saveDialog').close());
$('signOutBtn').addEventListener('click', signOutGoogleProfile);
$('clearBtn').addEventListener('click', () => { code.value = ''; updateLineNumbers(); code.focus(); });
$('clearConsole').addEventListener('click', resetConsole);
$('clearPlot').addEventListener('click', () => { plots = []; octavePlot = null; renderPlot(); });
$('newBtn').addEventListener('click', () => { loadText('% New SMAT script\n', 'untitled.m'); view('editor'); });
$('openBtn').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', async e => { const f = e.target.files[0]; if (f) { loadText(await f.text(), f.name); view('editor'); } e.target.value = ''; });
$('startExample').addEventListener('click', () => { loadText(DEFAULT_SCRIPT, 'untitled.m'); view('editor'); run(); });
$('menuBtn').addEventListener('click', () => $('sidebar').classList.toggle('open'));
document.querySelector('.main').addEventListener('click', e => { if (!e.target.closest('#menuBtn')) $('sidebar').classList.remove('open'); });
document.querySelectorAll('.nav').forEach(n => n.addEventListener('click', () => view(n.dataset.view)));
document.querySelectorAll('[data-example]').forEach(b => b.addEventListener('click', () => { loadText(examples[b.dataset.example], b.dataset.example + '.m'); view('editor'); }));
$('commandRun').addEventListener('click', runCommandLine);
$('command').addEventListener('keydown', e => { if (e.key === 'Enter') runCommandLine(); });
$('refreshVars').addEventListener('click', updateVars);

drawRecent(); drawSavedPrograms(); updateLineNumbers(); renderPlot();
if (location.protocol === 'http:' || location.protocol === 'https:') {
  fetch('/api/status', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(s => {
    if (!s) return;
    $('engineStatus').textContent = s.octave === false ? 'Octave not found · browser engine' : 'GNU Octave bridge connected';
    const hint = consoleEl.querySelector('.consolehint');
    if (hint) hint.innerHTML = (s.octave === false ? 'SMAT browser engine · Octave not found' : 'SMAT · GNU Octave bridge connected') + '<br>Press <b>Run</b> to execute your script.';
  }).catch(() => {});
}
})();
