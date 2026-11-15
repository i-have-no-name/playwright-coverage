import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = process.cwd();
const RAW_DIR = path.join(ROOT, 'coverage-raw');
const OUT_DIR = path.join(ROOT, 'coverage-report');
const SRC_DIR = 'src';
const COMMANDS_FILE = 'src/store/commands.ts';
const COMMANDS_FUNCTION = 'actionToCommand';
const SOCKET_FILE = 'src/store/socket.ts';
// https://github.com/<org>/<repo>; unset means the origin remote
const REPO_URL = process.env.REPO_URL;
const DIFF_BASE = process.env.DIFF_BASE ?? 'main';
const STAGES = ['component', 'handler', 'action', 'command', 'socket'];

const git = (args) => execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function repoUrl() {
  if (REPO_URL) return REPO_URL;
  try {
    return git('remote get-url origin').replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '');
  } catch {
    return '';
  }
}

// ---------- per-test coverage ----------

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function loadRuns() {
  if (!fs.existsSync(RAW_DIR)) return [];
  const position = (entry) => ({ file: entry.slice(0, entry.lastIndexOf(':')), line: Number(entry.slice(entry.lastIndexOf(':') + 1)) });
  return fs
    .readdirSync(RAW_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJson(path.join(RAW_DIR, name)))
    .sort((a, b) => `${a.file} ${a.name}`.localeCompare(`${b.file} ${b.name}`))
    .map((run) => ({ ...run, frames: run.frames.map((frame) => ({ topic: frame.topic, stack: frame.stack.map(position) })) }));
}

const locKey = (loc) => `${loc.start.line}:${loc.start.column}-${loc.end.line}:${loc.end.column}`;

function indexCoverage(runs) {
  const files = {};
  const maps = {};
  const entry = (bucket, loc) => (bucket[locKey(loc)] ??= { loc, tests: [] });
  const mapOf = (id) => {
    if (maps[id]) return maps[id];
    const map = readJson(path.join(RAW_DIR, 'maps', `${id}.json`));
    if (map.inputSourceMap) throw new Error(`${map.path}: coverage is in transformed-code coordinates; instrument the original source`);
    const file = (files[map.path] ??= { statements: {}, functions: {}, branches: {} });
    for (const loc of Object.values(map.statementMap)) entry(file.statements, loc);
    for (const fn of Object.values(map.fnMap)) entry(file.functions, fn.loc);
    for (const branch of Object.values(map.branchMap)) branch.locations.forEach((loc) => loc.start?.line && entry(file.branches, loc));
    return (maps[id] = { ...map, file });
  };
  runs.forEach((run, testIndex) => {
    const mark = (bucket, loc) => {
      const { tests } = entry(bucket, loc);
      if (tests.at(-1) !== testIndex) tests.push(testIndex);
    };
    for (const [id, hits] of Object.entries(run.hits)) {
      const map = mapOf(id);
      for (const key of Object.keys(hits.s)) mark(map.file.statements, map.statementMap[key]);
      for (const key of Object.keys(hits.f)) mark(map.file.functions, map.fnMap[key].loc);
      for (const [key, arms] of Object.entries(hits.b)) {
        arms.forEach((count, arm) => count && map.branchMap[key].locations[arm].start?.line && mark(map.file.branches, map.branchMap[key].locations[arm]));
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
  if (!units.length) units = file.functions.filter((unit) => unit.loc.start.line === line);
  if (!units.length) units = enclosing(file.statements, line).slice(0, 1);
  if (!units.length) units = enclosing(file.functions, line).slice(0, 1);
  if (!units.length) return NEUTRAL;
  const tests = [...new Set(units.flatMap((unit) => unit.tests))].sort((a, b) => a - b);
  const hit = units.filter((unit) => unit.tests.length).length;
  return { status: hit === units.length ? 'covered' : hit ? 'partial' : 'uncovered', tests };
}

// ---------- diff ----------

function buildDiff(coverage, baseSha) {
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
      file.lines.push({ type: '-', oldNo: oldNo++, near: newNo, text: line.slice(1) });
    } else if (line[0] === ' ') {
      file.lines.push({ type: ' ', oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
    }
  }
  // `git diff` skips untracked files, so list them as fully added
  for (const untracked of git(`ls-files --others --exclude-standard -- ${SRC_DIR}`).split('\n')) {
    if (!/\.[jt]sx?$/.test(untracked)) continue;
    const lines = fs.readFileSync(path.join(ROOT, untracked), 'utf8').replace(/\n$/, '').split('\n');
    const added = lines.map((text, index) => ({ type: '+', newNo: index + 1, text, ...lineCoverage(coverage[untracked], index + 1, text) }));
    files.push({ path: untracked, lines: [{ type: '@', text: '@@ new untracked file @@' }, ...added] });
  }
  return files;
}

function changedLines(diff) {
  const changed = {};
  for (const file of diff) {
    const lines = file.lines.filter((line) => line.type === '+' || line.type === '-');
    changed[file.path] = lines.map((line) => line.newNo ?? line.near);
  }
  return changed;
}

// ---------- static flow analysis: call site -> action -> command ----------

const isFunction = (node) =>
  ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node);
const isWrapper = (node) => ts.isCallExpression(node) && /^(React\.)?(useCallback|memo|forwardRef)$/.test(node.expression.getText());
const holder = (fn) => (isWrapper(fn.parent) && fn.parent.arguments[0] === fn ? fn.parent.parent : fn.parent);

function functionName(fn) {
  if (fn.name) return fn.name.getText();
  const parent = holder(fn);
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) return parent.name.getText();
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) return parent.parent.name.getText();
  if (ts.isCallExpression(parent) && parent.arguments.includes(fn)) return parent.expression.getText();
  return null;
}

export function scan() {
  const inSrc = (fileName) => path.relative(ROOT, fileName).startsWith(`${SRC_DIR}${path.sep}`);
  const config = ts.getParsedCommandLineOfConfigFile(path.join(ROOT, 'tsconfig.json'), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  });
  const program = ts.createProgram({
    rootNames: config.fileNames.filter(inSrc),
    options: config.options,
    host: ts.createCompilerHost(config.options, true),
  });
  const checker = program.getTypeChecker();
  const sources = program
    .getSourceFiles()
    .filter((source) => inSrc(source.fileName))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
  const lineAt = (node, position) => node.getSourceFile().getLineAndCharacterOfPosition(position);
  const where = (node) => {
    const { line, character } = lineAt(node, node.getStart());
    return { file: path.relative(ROOT, node.getSourceFile().fileName), line: line + 1, column: character };
  };
  const lastLine = (node) => lineAt(node, node.getEnd()).line + 1;
  const local = (node) => !!node && isFunction(node) && inSrc(node.getSourceFile().fileName);
  const notes = [];

  const creators = new Map();
  const byType = new Map();
  const collectCreators = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText() === 'createAction') {
      creators.set(node, { name: node.name.getText(), ...where(node) });
      const type = node.initializer.arguments[0];
      if (type && ts.isStringLiteralLike(type)) byType.set(type.text, node);
    }
    const options = ts.isCallExpression(node) && node.expression.getText() === 'createSlice' && node.arguments[0];
    if (options && ts.isObjectLiteralExpression(options)) {
      const option = (name) => options.properties.find((entry) => entry.name?.getText() === name)?.initializer;
      const slice = option('name');
      const reducers = option('reducers');
      for (const member of reducers && ts.isObjectLiteralExpression(reducers) ? reducers.properties : []) {
        if (!member.name) continue;
        const type = `${slice && ts.isStringLiteralLike(slice) ? slice.text : '?'}/${member.name.getText()}`;
        creators.set(member, { name: type, ...where(member) });
        byType.set(type, member);
      }
    }
    ts.forEachChild(node, collectCreators);
  };
  sources.forEach(collectCreators);

  const declarationOf = (symbol) => {
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  };
  // ponytail: follows names, not values; a creator or wrapper reached through a function parameter, an array or a computed key resolves to nothing
  const follow = (declaration, hops) => {
    if (!declaration || hops > 8) return null;
    if (creators.has(declaration) || isFunction(declaration)) return declaration;
    if (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) return resolve(declaration.initializer, hops + 1);
    if (ts.isShorthandPropertyAssignment(declaration)) {
      return follow(declarationOf(checker.getShorthandAssignmentValueSymbol(declaration)), hops + 1);
    }
    const owner = ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent) && declaration.parent.parent;
    if (owner && ts.isVariableDeclaration(owner) && owner.initializer) {
      const property = (declaration.propertyName ?? declaration.name).getText();
      return follow(declarationOf(checker.getTypeAtLocation(owner.initializer).getProperty(property)), hops + 1);
    }
    return null;
  };
  const resolve = (node, hops = 0) => {
    if (!node) return null;
    if (isFunction(node)) return node;
    if (isWrapper(node)) return resolve(node.arguments[0], hops);
    if (!ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node)) return null;
    return follow(declarationOf(checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : node)), hops);
  };

  // ponytail: reads `if (<creator>.match(action)) { return { topic: '...' } }` inside actionToCommand; a switch or lookup table needs its own reader here
  const commands = new Map();
  const collectCommands = (node, inside, branch) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === COMMANDS_FUNCTION) inside = true;
    if (inside && ts.isIfStatement(node)) {
      let creator = null;
      const findCreator = (child) => {
        const target = ts.isPropertyAccessExpression(child) && ['match', 'type'].includes(child.name.text) && resolve(child.expression);
        if (creators.has(target)) creator ??= target;
        ts.forEachChild(child, findCreator);
      };
      findCreator(node.expression);
      const topic = node.thenStatement.getText().match(/topic:\s*['"`]([^'"`]+)/)?.[1];
      if (creator && topic) {
        let line = where(node.thenStatement).line;
        const findReturn = (child) => {
          if (ts.isReturnStatement(child)) line = where(child).line;
          else ts.forEachChild(child, findReturn);
        };
        findReturn(node.thenStatement);
        commands.set(creator, { topic, line, start: where(node).line, end: lastLine(node) });
        collectCommands(node.thenStatement, inside, true);
        if (node.elseStatement) collectCommands(node.elseStatement, inside, branch);
        return;
      }
      if (!branch) notes.push({ ...where(node), text: `${COMMANDS_FUNCTION}: branch not understood, expected <action creator>.match(action) with a literal topic` });
    }
    if (inside && !branch && ts.isSwitchStatement(node)) notes.push({ ...where(node), text: `${COMMANDS_FUNCTION}: switch is not read, only if (<action creator>.match(action)) branches are` });
    ts.forEachChild(node, (child) => collectCommands(child, inside, branch));
  };
  collectCommands(program.getSourceFile(path.join(ROOT, COMMANDS_FILE)), false, false);

  const found = [];
  const calls = new Map();
  const passed = new Set();
  const consumers = /^(addCase|addMatcher|isAnyOf|isAllOf|take\w*|debounce|throttle)$/;
  for (const source of sources) {
    const visit = (node, functions) => {
      if (isFunction(node)) functions = [...functions, node];
      if (ts.isCallExpression(node)) {
        const target = resolve(node.expression);
        if (commands.has(target)) found.push({ node, functions, creator: target });
        else if (local(target)) calls.set(target, [...(calls.get(target) ?? []), { node, functions }]);
        for (const argument of node.arguments) {
          const value = ts.isIdentifier(argument) && resolve(argument);
          if (local(value)) passed.add(value);
          if (commands.has(value) && !consumers.test(node.expression.getText().split('.').at(-1))) {
            notes.push({ ...where(argument), text: `Action creator "${creators.get(value).name}" is passed as a value here; a dispatch through it is not tracked` });
          }
        }
      }
      if (ts.isObjectLiteralExpression(node)) {
        const type = node.properties.find((entry) => ts.isPropertyAssignment(entry) && entry.name.getText() === 'type')?.initializer;
        const target =
          type && (ts.isStringLiteralLike(type) ? byType.get(type.text) : ts.isPropertyAccessExpression(type) && type.name.text === 'type' && resolve(type.expression));
        if (commands.has(target)) found.push({ node, functions, creator: target });
      }
      ts.forEachChild(node, (child) => visit(child, functions));
    };
    visit(source, []);
  }

  const describe = (node, functions) => {
    const named = functions.map((fn) => ({ fn, name: functionName(fn) })).filter((entry) => entry.name);
    const owner = functions.at(-1);
    return { place: named[0], handler: named.at(-1), start: owner ? where(owner).line : 1, end: lastLine(owner ?? node.getSourceFile()) };
  };

  const propCalls = (fn, component, prop) => {
    const param = fn.parameters[0];
    if (!param) return [];
    const binding = ts.isObjectBindingPattern(param.name)
      ? param.name.elements.find((element) => (element.propertyName ?? element.name).getText() === prop)?.name.getText()
      : null;
    const isPropCall = (callee) =>
      binding
        ? ts.isIdentifier(callee) && callee.text === binding
        : ts.isPropertyAccessExpression(callee) && callee.expression.getText() === param.name.getText() && callee.name.text === prop;
    const triggers = [];
    const visit = (node, owner) => {
      if (isFunction(node)) owner = node;
      if (ts.isCallExpression(node) && isPropCall(node.expression)) {
        const name = owner === fn ? '(body)' : (functionName(owner) ?? '(anonymous)');
        triggers.push({ ...where(node), component, name, calls: `prop ${prop}`, start: where(owner).line, end: lastLine(owner) });
      }
      ts.forEachChild(node, (child) => visit(child, owner));
    };
    visit(fn, fn);
    return triggers;
  };

  const propTriggers = (handlerFn) => {
    const parent = holder(handlerFn);
    const attributes = [];
    if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) {
      attributes.push(parent.parent);
    } else if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      const collect = (node) => {
        const value = ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression;
        if (value && ts.isIdentifier(value) && value.text === parent.name.text && resolve(value) === handlerFn) attributes.push(node);
        ts.forEachChild(node, collect);
      };
      collect(handlerFn.getSourceFile());
    }
    return attributes.map((attribute) => {
      const tag = attribute.parent.parent.tagName;
      const component = /^[A-Z]/.test(tag.getText()) && resolve(tag);
      return local(component) ? propCalls(component, tag.getText(), attribute.name.getText()) : [];
    });
  };

  const callTriggers = (handler) =>
    (calls.get(handler.fn) ?? [])
      .filter((call) => !call.functions.includes(handler.fn))
      .map(({ node, functions }) => {
        const caller = describe(node, functions);
        const position = where(node);
        return {
          ...position,
          component: caller.place?.name ?? path.basename(position.file),
          name: caller.handler && caller.handler !== caller.place ? caller.handler.name : '(body)',
          calls: handler.name,
          start: caller.start,
          end: caller.end,
        };
      });

  // ponytail: ways into a handler (null = right here, a child calling it as a prop, a function calling it) are followed one level deep;
  // a prop forwarded again, or a wrapper called by another wrapper, stays one entry
  const entriesOf = (handler) => {
    const entries = [...propTriggers(handler.fn).flatMap((list) => (list.length ? list : [null])), ...callTriggers(handler)];
    if (!entries.length || (passed.has(handler.fn) && !entries.includes(null))) entries.unshift(null);
    return [...new Set(entries)];
  };

  const sites = found.flatMap(({ node, functions, creator }) => {
    const { place, handler, start, end } = describe(node, functions);
    const position = where(node);
    const ownLine = handler ? where(handler.fn).line : position.line;
    return (handler ? entriesOf(handler) : [null]).map((trigger) => ({
      ...position,
      action: creators.get(creator).name,
      actionFile: creators.get(creator).file,
      actionLine: creators.get(creator).line,
      place: place?.name ?? path.basename(position.file),
      placeLine: place ? where(place.fn).line : 1,
      handler: trigger ? `${trigger.component}.${trigger.name}` : handler && handler !== place ? handler.name : '(body)',
      handlerFile: trigger?.file ?? position.file,
      handlerLine: trigger?.start ?? ownLine,
      ownLine,
      ownEnd: handler ? lastLine(handler.fn) : position.line,
      innerStart: start,
      innerEnd: end,
      trigger,
      command: commands.get(creator),
    }));
  });

  for (const [creator, command] of commands) {
    if (found.some((entry) => entry.creator === creator)) continue;
    const { name, file, line } = creators.get(creator);
    notes.push({ file, line, text: `No call site found for action "${name}" (${command.topic}): unused, or dispatched in a way the scan cannot follow` });
  }
  return { sites, notes, topics: new Set([...commands.values()].map((command) => command.topic)) };
}

function buildFlows(coverage, runs, changed) {
  const touched = (file, from, to) => !!changed[file]?.some((line) => line >= from && line <= to);
  const { sites, notes, topics } = scan();
  const everyTest = runs.map((_, index) => index);
  const through = (frame, file, from, to) => frame.stack.some((entry) => entry.file === file && entry.line >= from && entry.line <= to);
  const atSite = (frame, site) => through(frame, site.file, site.innerStart, site.innerEnd);
  const atTrigger = (frame, trigger) => through(frame, trigger.file, trigger.start, trigger.end);

  const flows = sites.map((site, id) => {
    const { command, trigger, ...rest } = site;
    const file = coverage[site.file];
    const functions = file ? enclosing(file.functions, site.line, site.column) : [];
    const statement = file && enclosing(file.statements, site.line, site.column)[0];
    const triggered = trigger && (enclosing(coverage[trigger.file]?.statements ?? [], trigger.line, trigger.column)[0]?.tests ?? []);
    const handled = functions[0]?.tests ?? [];
    const sameAction = sites.filter((other) => other.command === command);
    const otherWaysIn = sameAction.filter((other) => other.trigger && other.file === site.file && other.line === site.line && other.column === site.column);
    // ponytail: a frame sent with no call site of its action on the stack (saga put, timer, promise chain) counts for every call site of that
    // action the test executed; tag dispatches with an id if two async sites of one action must be told apart
    const sent = (frame) =>
      frame.topic === command.topic &&
      (atSite(frame, site)
        ? trigger
          ? atTrigger(frame, trigger)
          : !otherWaysIn.some((other) => atTrigger(frame, other.trigger))
        : !sameAction.some((other) => atSite(frame, other)));
    const reached = [
      functions.at(-1)?.tests ?? [],
      trigger ? handled.filter((test) => triggered.includes(test)) : handled,
      statement?.tests ?? [],
      lineCoverage(coverage[COMMANDS_FILE], command.line, 'return').tests,
      everyTest.filter((index) => runs[index].frames.some(sent)),
    ];
    let alive = everyTest;
    const stages = reached.map((tests, index) => {
      alive = alive.filter((test) => tests.includes(test));
      return { name: STAGES[index], tests: alive };
    });
    const status = stages.at(-1).tests.length ? 'covered' : stages[1].tests.length ? 'partial' : 'uncovered';
    const reason = touched(site.file, site.line, site.line)
      ? 'call site changed'
      : touched(site.file, site.ownLine, site.ownEnd) || (trigger && touched(trigger.file, trigger.start, trigger.end))
        ? 'handler changed'
        : touched(COMMANDS_FILE, command.start, command.end)
          ? 'command mapping changed'
          : changed[site.file]
            ? 'file changed'
            : null;
    return { id, ...rest, trigger, topic: command.topic, commandLine: command.line, changed: reason, status, stages };
  });

  const frames = runs.flatMap((run) => run.frames);
  if (frames.length && frames.every((frame) => !frame.stack.length)) {
    notes.push({ text: 'Socket frames carry no source positions (source maps missing?): a frame counts for every call site of its action the test executed' });
  }
  for (const frame of frames) {
    if (!frame.topic) continue;
    const origin = frame.stack.find((entry) => entry.file !== SOCKET_FILE);
    if (!topics.has(frame.topic)) {
      notes.push({ ...origin, text: `Socket frame "${frame.topic}" was sent in a test, but ${COMMANDS_FUNCTION} has no readable mapping for it` });
    } else if (origin && !sites.some((site) => site.command.topic === frame.topic && atSite(frame, site))) {
      notes.push({ ...origin, text: `Socket frame "${frame.topic}" was sent from here, outside every known call site of its action` });
    }
  }
  const unique = [...new Map(notes.map((note) => [`${note.file}:${note.line}:${note.text}`, note])).values()];
  return { flows, notes: unique };
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
  if (data.notes.length) {
    out.push('', '### Scan notes', '', ...data.notes.map((note) => `- ${note.text}${note.file ? ` (\`${note.file}:${note.line}\`)` : ''}`));
  }
  out.push('', '### Tests', '', ...data.tests.map((test, index) => `- **T${index + 1}** ${test.name} (\`${test.file}:${test.line}\`, ${test.status})`), '');
  return out.join('\n');
}

export async function generate() {
  const runs = loadRuns();
  if (!runs.length) {
    console.log('\nNo coverage collected, change coverage report left as is.');
    return null;
  }
  const coverage = indexCoverage(runs);
  const data = {
    generatedAt: new Date().toISOString(),
    base: DIFF_BASE,
    head: '(no git)',
    sha: '',
    root: ROOT,
    repo: repoUrl(),
    commandsFile: COMMANDS_FILE,
    socket: {
      file: SOCKET_FILE,
      line: fs.readFileSync(path.join(ROOT, SOCKET_FILE), 'utf8').split('\n').findIndex((line) => line.includes('.send(')) + 1,
    },
    stages: STAGES,
    tests: runs.map(({ name, file, line, status }) => ({ name, file, line, status })),
    diff: [],
    flows: [],
    notes: [],
  };
  try {
    data.head = git('rev-parse --abbrev-ref HEAD');
    data.sha = git('rev-parse HEAD');
    data.diff = buildDiff(coverage, git(`merge-base ${DIFF_BASE} HEAD`));
  } catch {
    data.diffError = `Cannot diff against "${DIFF_BASE}". Set DIFF_BASE to an existing ref.`;
  }
  Object.assign(data, buildFlows(coverage, runs, changedLines(data.diff)));
  const template = fs.readFileSync(new URL('./report-template.html', import.meta.url), 'utf8');
  const json = JSON.stringify(data).replaceAll('<', '\\u003c');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), template.replace('__DATA__', () => json));
  fs.writeFileSync(path.join(OUT_DIR, 'summary.md'), summaryMarkdown(data));
  console.log(`\nChange coverage report: ${path.join(OUT_DIR, 'index.html')}`);
  return data;
}

export default class ChangeCoverageReporter {
  onBegin(config) {
    this.shard = config.shard;
    if (!this.shard || this.shard.current === 1) fs.rmSync(RAW_DIR, { recursive: true, force: true });
  }

  async onEnd() {
    if (!this.shard) return void (await generate());
    console.log(`\nShard ${this.shard.current}/${this.shard.total}: coverage kept in ${RAW_DIR}; run "npm run report" once every shard is there.`);
  }

  printsToStdio() {
    return false;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await generate();
