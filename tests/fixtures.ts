import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { SourceMap } from 'node:module';
import path from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';

const RAW_DIR = path.resolve('coverage-raw');
const MAPS_DIR = path.join(RAW_DIR, 'maps');
const sourceMaps = new Map<string, Promise<SourceMap | null>>();

async function loadSourceMap(url: string) {
  const script = await (await fetch(url)).text();
  const reference = script.match(/\/\/# sourceMappingURL=(\S+)\s*$/)?.[1];
  return reference ? new SourceMap(await (await fetch(new URL(reference, url))).json()) : null;
}

async function sourcePositions(stack: string) {
  const positions: string[] = [];
  for (const [, url, line, column] of stack.matchAll(/(https?:\/\/[^\s)]+):(\d+):(\d+)/g)) {
    if (!sourceMaps.has(url)) sourceMaps.set(url, loadSourceMap(url).catch(() => null));
    const entry = (await sourceMaps.get(url))?.findEntry(Number(line) - 1, Number(column) - 1);
    // ponytail: expects webpack/rspack source names (webpack://app/./src/file.tsx); other bundlers need their own prefix rule here
    const source = entry && 'originalSource' in entry && entry.originalSource.match(/\.\/(?!node_modules\/)(.+)$/)?.[1];
    if (source) positions.push(`${source}:${entry.originalLine + 1}`);
  }
  return positions;
}

function topicOf(data: string) {
  try {
    return JSON.parse(data).topic as string | undefined;
  } catch {
    return undefined;
  }
}

export const test = base.extend<{ collectCoverage: void }>({
  collectCoverage: [
    async ({ page }, use, testInfo) => {
      await page.addInitScript(() => {
        Error.stackTraceLimit = 100;
        const frames: unknown[] = ((window as any).__wsFrames__ = []);
        const send = WebSocket.prototype.send;
        WebSocket.prototype.send = function (data) {
          frames.push({ data: String(data), stack: new Error().stack });
          return send.call(this, data);
        };
      });
      await use();
      // ponytail: reads coverage once at test end, a full page reload mid-test loses earlier counters; flush on 'framenavigated' if tests start reloading
      const collected = await page
        .evaluate(() => {
          const hit = (counts: Record<string, number | number[]>) =>
            Object.fromEntries(Object.entries(counts).filter(([, count]) => [count].flat().some(Boolean)));
          return {
            files: Object.values<any>((window as any).__coverage__ ?? {}).map((file) => ({
              path: file.path as string,
              hash: String(file.hash),
              s: hit(file.s),
              f: hit(file.f),
              b: hit(file.b),
            })),
            frames: ((window as any).__wsFrames__ ?? []) as { data: string; stack: string }[],
          };
        })
        .catch(() => ({ files: [], frames: [] }));

      fs.mkdirSync(MAPS_DIR, { recursive: true });
      const hits: Record<string, unknown> = {};
      const missing: Record<string, string> = {};
      for (const { path: file, hash, ...counts } of collected.files) {
        const id = createHash('sha1').update(`${path.relative(process.cwd(), file)}:${hash}`).digest('hex');
        hits[id] = counts;
        if (!fs.existsSync(path.join(MAPS_DIR, `${id}.json`))) missing[file] = id;
      }
      if (Object.keys(missing).length) {
        const maps = await page.evaluate(
          (files) =>
            files.map((file) => {
              const { statementMap, fnMap, branchMap, inputSourceMap } = (window as any).__coverage__[file];
              return { file, statementMap, fnMap, branchMap, inputSourceMap };
            }),
          Object.keys(missing),
        );
        for (const { file, ...map } of maps) {
          const content = JSON.stringify({ path: path.relative(process.cwd(), file), ...map });
          fs.writeFileSync(path.join(MAPS_DIR, `${missing[file]}.json`), content);
        }
      }

      const frames = [];
      for (const { data, stack } of collected.frames) {
        frames.push({ topic: topicOf(data), stack: await sourcePositions(stack) });
      }
      fs.writeFileSync(
        path.join(RAW_DIR, `${testInfo.testId}.json`),
        JSON.stringify({
          name: testInfo.title,
          file: path.relative(process.cwd(), testInfo.file),
          line: testInfo.line,
          status: testInfo.status,
          hits,
          frames,
        }),
      );
    },
    { auto: true },
  ],
});

export async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByText('connected', { exact: true })).toBeVisible();
}

export const acks = (page: Page) => page.getByRole('list', { name: 'Server acks' }).getByRole('listitem');

export { expect };
