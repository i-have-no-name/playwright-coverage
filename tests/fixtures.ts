import fs from 'node:fs';
import path from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';

const RAW_DIR = path.resolve('coverage-raw');

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
        .evaluate(() => ({ coverage: (window as any).__coverage__, frames: (window as any).__wsFrames__ }))
        .catch(() => ({ coverage: {}, frames: [] }));
      fs.mkdirSync(RAW_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(RAW_DIR, `${testInfo.testId}.json`),
        JSON.stringify({
          name: testInfo.title,
          file: path.relative(process.cwd(), testInfo.file),
          line: testInfo.line,
          status: testInfo.status,
          ...collected,
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
