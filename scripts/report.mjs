import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import libCoverage from 'istanbul-lib-coverage';
import libSourceMaps from 'istanbul-lib-source-maps';
import ts from 'typescript';

const ROOT = process.cwd();
const RAW_DIR = path.join(ROOT, 'coverage-raw');
const OUT_DIR = path.join(ROOT, 'coverage-report');
const SRC_DIR = 'src';
const ACTIONS_FILE = 'src/store/actions.ts';
const COMMANDS_FILE = 'src/store/commands.ts';
const COMMANDS_FUNCTION = 'actionToCommand';
const DIFF_BASE = process.env.DIFF_BASE ?? 'main';
const STAGES = ['component', 'handler', 'action', 'command', 'socket'];

const git = (args) => execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

// ---------- per-test coverage ----------

function parseFrame({ data, stack }) {
  try {
    const { topic } = JSON.parse(data);
    const files = [...String(stack).matchAll(/https?:\/\/[^/\s]+\/([^\s?:)]+)/g)].map((match) => match[1]);
    return topic ? [{ topic, files: [...new Set(files)] }] : [];
  } catch {
    return [];
  }
}

async function loadRuns() {
  if (!fs.existsSync(RAW_DIR)) return [];
  const runs = fs
    .readdirSync(RAW_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(RAW_DIR, name), 'utf8')))
    .sort((a, b) => `${a.file} ${a.name}`.localeCompare(`${b.file} ${b.name}`));
  for (const run of runs) {
    const remapped = await libSourceMaps
      .createSourceMapStore()
      .transformCoverage(libCoverage.createCoverageMap(run.coverage ?? {}));
    run.coverage = JSON.parse(JSON.stringify(remapped));
    run.frames = (run.frames ?? []).flatMap(parseFrame);
  }
  return runs;
}

const locKey = (loc) => `${loc.start.line}:${loc.start.column}-${loc.end.line}:${loc.end.column}`;

function indexCoverage(runs) {
  const files = {};
  const collect = (bucket, loc, hit, testIndex) => {
    const entry = (bucket[locKey(loc)] ??= { loc, tests: [] });
    if (hit && entry.tests.at(-1) !== testIndex) entry.tests.push(testIndex);
  };
  runs.forEach((run, testIndex) => {
    for (const [absolute, cov] of Object.entries(run.coverage)) {
      const file = (files[path.relative(ROOT, absolute)] ??= { statements: {}, functions: {}, branches: {} });
      for (const [id, loc] of Object.entries(cov.statementMap)) collect(file.statements, loc, cov.s[id] > 0, testIndex);
      for (const [id, fn] of Object.entries(cov.fnMap)) collect(file.functions, fn.loc, cov.f[id] > 0, testIndex);
      for (const [id, branch] of Object.entries(cov.branchMap)) {
        branch.locations.forEach((loc, arm) => loc.start?.line && collect(file.branches, loc, cov.b[id][arm] > 0, testIndex));
      }
    }
  });
  for (const file of Object.values(files)) {
    file.statements = Object.values(file.statements);
    file.functions = Object.values(file.functions);
    file.branches = Object.values(file.branches);
  }
  return files;
}

function contains(loc, line, column = null) {
  const afterStart = line > loc.start.line || (line === loc.start.line && (column === null || column >= loc.start.column));
  const beforeEnd = line < loc.end.line || (line === loc.end.line && (column === null || column <= (loc.end.column ?? Infinity)));
  return afterStart && beforeEnd;
}

const span = (loc) => (loc.end.line - loc.start.line) * 1e5 + ((loc.end.column ?? 1e5 - 1) - loc.start.column);
const enclosing = (items, line, column) =>
  items.filter((item) => contains(item.loc, line, column)).sort((a, b) => span(a.loc) - span(b.loc));

const NEUTRAL = { status: 'neutral', tests: [] };
const NOT_CODE = /^\s*(\/\/.*|\/?\*.*|[\])}>;,(]*|(import|export type|type|interface)\b.*)$/;

function lineCoverage(file, line, text) {
  if (NOT_CODE.test(text)) return NEUTRAL;
  if (!file) return { status: 'uncovered', tests: [] };
  let units = [...file.statements, ...file.branches].filter((unit) => unit.loc.start.line === line);
  if (!units.length) units = enclosing(file.statements, line).slice(0, 1);
  if (!units.length) units = enclosing(file.functions, line).slice(0, 1);
  if (!units.length) return NEUTRAL;
  const tests = [...new Set(units.flatMap((unit) => unit.tests))].sort((a, b) => a - b);
  const hit = units.filter((unit) => unit.tests.length).length;
  return { status: hit === units.length ? 'covered' : hit ? 'partial' : 'uncovered', tests };
}

// ---------- diff ----------

function buildDiff(coverage, baseSha) {
  // ponytail: tracked files only, untracked new files are invisible to `git diff`; `git add -N` them or commit first
  const raw = git(`diff --no-color -U3 ${baseSha} -- ${SRC_DIR}`);
  const files = [];
  let file = null;
  let oldNo = 0;
  let newNo = 0;
  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git')) {
      file = null;
    } else if (!file) {
      if (line.startsWith('+++ b/')) files.push((file = { path: line.slice(6), lines: [] }));
    } else if (line.startsWith('@@')) {
      [, oldNo, newNo] = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/).map(Number);
      file.lines.push({ type: '@', text: line });
    } else if (line[0] === '+') {
      const text = line.slice(1);
      file.lines.push({ type: '+', newNo, text, ...lineCoverage(coverage[file.path], newNo, text) });
      newNo += 1;
    } else if (line[0] === '-') {
      file.lines.push({ type: '-', oldNo: oldNo++, text: line.slice(1) });
    } else if (line[0] === ' ') {
      file.lines.push({ type: ' ', oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
    }
  }
  return files;
}

// ---------- static flow analysis: call site -> action -> command ----------

const parse = (file) =>
  ts.createSourceFile(file, fs.readFileSync(path.join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true);

const isFunction = (node) =>
  ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node);

function functionName(fn, source) {
  if (fn.name) return fn.name.getText(source);
  const parent = fn.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) return parent.name.getText(source);
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) return parent.parent.name.getText(source);
  if (ts.isCallExpression(parent) && parent.arguments.includes(fn)) return parent.expression.getText(source);
  return null;
}

// ponytail: assumes `if (<creator> ...) { return { topic: '...' } }` inside actionToCommand; a lookup-table mapping needs its own reader here
function findCommands() {
  const actionsSource = parse(ACTIONS_FILE);
  const creators = [];
  const collectCreators = (node) => {
    const init = ts.isVariableDeclaration(node) && node.initializer;
    if (init && ts.isCallExpression(init) && init.expression.getText(actionsSource) === 'createAction') {
      creators.push(node.name.getText(actionsSource));
    }
    ts.forEachChild(node, collectCreators);
  };
  collectCreators(actionsSource);

  const source = parse(COMMANDS_FILE);
  const commands = {};
  const visit = (node, inside) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === COMMANDS_FUNCTION) inside = true;
    if (inside && ts.isIfStatement(node)) {
      const condition = node.expression.getText(source);
      const action = creators.find((name) => new RegExp(`\\b${name}\\b`).test(condition));
      const topic = node.thenStatement.getText(source).match(/topic:\s*['"`]([^'"`]+)/)?.[1];
      let line = source.getLineAndCharacterOfPosition(node.thenStatement.getStart(source)).line + 1;
      const findReturn = (child) => {
        if (ts.isReturnStatement(child)) line = source.getLineAndCharacterOfPosition(child.getStart(source)).line + 1;
        else ts.forEachChild(child, findReturn);
      };
      findReturn(node.thenStatement);
      if (action && topic) commands[action] = { topic, line };
    }
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(source, false);
  return commands;
}

// ponytail: matches direct `creator(...)` calls by identifier; bindActionCreators / re-exported aliases are not followed
function findCallSites(commands) {
  const sites = [];
  const files = fs
    .readdirSync(path.join(ROOT, SRC_DIR), { recursive: true })
    .map((name) => path.join(SRC_DIR, name))
    .filter((file) => /\.tsx?$/.test(file) && file !== ACTIONS_FILE && file !== COMMANDS_FILE)
    .sort();
  for (const file of files) {
    const source = parse(file);
    const position = (node) => source.getLineAndCharacterOfPosition(node.getStart(source));
    const visit = (node, functions) => {
      if (isFunction(node)) functions = [...functions, node];
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && commands[node.expression.text]) {
        const named = functions.map((fn) => ({ fn, name: functionName(fn, source) })).filter((entry) => entry.name);
        const place = named[0];
        const handler = named.at(-1);
        const { line, character } = position(node);
        sites.push({
          file,
          line: line + 1,
          column: character,
          action: node.expression.text,
          place: place?.name ?? path.basename(file),
          handler: handler && handler !== place ? handler.name : '(body)',
          handlerLine: handler ? position(handler.fn).line + 1 : line + 1,
        });
      }
      ts.forEachChild(node, (child) => visit(child, functions));
    };
    visit(source, []);
  }
  return sites;
}

function buildFlows(coverage, runs) {
  const commands = findCommands();
  const everyTest = runs.map((_, index) => index);
  return findCallSites(commands).map((site, id) => {
    const command = commands[site.action];
    const file = coverage[site.file];
    const functions = file ? enclosing(file.functions, site.line, site.column) : [];
    const statement = file && enclosing(file.statements, site.line, site.column)[0];
    const reached = [
      functions.at(-1)?.tests ?? [],
      functions[0]?.tests ?? [],
      statement?.tests ?? [],
      lineCoverage(coverage[COMMANDS_FILE], command.line, 'return').tests,
      // ponytail: frame is tied to the call site by file, not line; two call sites of one action in one file both executed in one test are indistinguishable
      everyTest.filter((index) =>
        runs[index].frames.some((frame) => frame.topic === command.topic && frame.files.includes(site.file)),
      ),
    ];
    let alive = everyTest;
    const stages = reached.map((tests, index) => {
      alive = alive.filter((test) => tests.includes(test));
      return { name: STAGES[index], tests: alive };
    });
    const status = stages.at(-1).tests.length ? 'covered' : stages[1].tests.length ? 'partial' : 'uncovered';
    return { id, ...site, topic: command.topic, status, stages };
  });
}

// ---------- output ----------

const addedLines = (file) => file.lines.filter((line) => line.type === '+' && line.status !== 'neutral');
const coveredLines = (file) => addedLines(file).filter((line) => line.status === 'covered');
const percent = (part, total) => (total ? `${Math.round((part / total) * 100)}%` : 'n/a');

function summaryMarkdown(data) {
  const tag = (tests) =>
    tests.length === data.tests.length
      ? 'all tests'
      : tests.slice(0, 4).map((index) => `T${index + 1}`).join(', ') + (tests.length > 4 ? ` +${tests.length - 4}` : '');
  const mark = { covered: '✓', partial: '◐', uncovered: '✕', neutral: ' ' };
  const total = data.diff.flatMap(addedLines).length;
  const covered = data.diff.flatMap(coveredLines).length;
  const flowsCovered = data.flows.filter((flow) => flow.status === 'covered').length;
  const failed = data.tests.filter((test) => test.status !== 'passed').length;
  const out = [
    `## Change coverage: \`${data.head}\` vs \`${data.base}\``,
    '',
    `**Tests:** ${data.tests.length - failed} passed${failed ? `, ${failed} failed` : ''} · ` +
      `**Changed lines covered:** ${covered}/${total} (${percent(covered, total)}) · ` +
      `**Socket flows covered:** ${flowsCovered}/${data.flows.length}`,
    '',
    '### Changed lines',
  ];
  for (const file of data.diff) {
    out.push('', `<details><summary><code>${file.path}</code> — ${coveredLines(file).length}/${addedLines(file).length} changed lines covered</summary>`, '', '```');
    for (const line of file.lines.filter((entry) => entry.type === '+')) {
      const note = line.status === 'neutral' ? '' : line.tests.length ? `  ← ${tag(line.tests)}` : '  ← NOT COVERED';
      out.push(`${String(line.newNo).padStart(4)} ${mark[line.status]} ${line.text}${note}`);
    }
    out.push('```', '', '</details>');
  }
  out.push('', '### Flows that never reach the socket', '', '| Origin | Action | Command | Last stage reached |', '|---|---|---|---|');
  for (const flow of data.flows.filter((entry) => entry.status !== 'covered')) {
    const last = flow.stages.findLast((stage) => stage.tests.length)?.name ?? 'none';
    out.push(`| \`${flow.place}\` › \`${flow.handler}\` (${flow.file}:${flow.line}) | \`${flow.action}\` | \`${flow.topic}\` | ${last} |`);
  }
  out.push('', '### Tests', '', ...data.tests.map((test, index) => `- **T${index + 1}** ${test.name} (\`${test.file}\`, ${test.status})`), '');
  return out.join('\n');
}

export async function generate() {
  const runs = await loadRuns();
  const coverage = indexCoverage(runs);
  const data = {
    generatedAt: new Date().toISOString(),
    base: DIFF_BASE,
    head: '(no git)',
    stages: STAGES,
    tests: runs.map(({ name, file, status }) => ({ name, file, status })),
    diff: [],
    flows: buildFlows(coverage, runs),
  };
  try {
    data.head = git('rev-parse --abbrev-ref HEAD');
    data.diff = buildDiff(coverage, git(`merge-base ${DIFF_BASE} HEAD`));
  } catch {
    data.diffError = `Cannot diff against "${DIFF_BASE}". Set DIFF_BASE to an existing ref.`;
  }
  const template = fs.readFileSync(new URL('./report-template.html', import.meta.url), 'utf8');
  const json = JSON.stringify(data).replaceAll('<', '\\u003c');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), template.replace('__DATA__', () => json));
  fs.writeFileSync(path.join(OUT_DIR, 'summary.md'), summaryMarkdown(data));
  console.log(`\nChange coverage report: ${path.join(OUT_DIR, 'index.html')}`);
  return data;
}

export default class ChangeCoverageReporter {
  onBegin() {
    fs.rmSync(RAW_DIR, { recursive: true, force: true });
  }

  async onEnd() {
    await generate();
  }

  printsToStdio() {
    return false;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await generate();
