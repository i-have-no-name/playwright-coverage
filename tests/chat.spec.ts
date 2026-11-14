import { acks, expect, openApp, test } from './fixtures';

test('chat: join lobby and send message', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Join lobby', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message' }).fill('hello');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('list', { name: 'Messages' }).getByRole('listitem')).toHaveText(['hello']);
  await expect(acks(page)).toHaveText(['room.join', 'state.sync', 'message.send']);
});

test('chat: empty message is not sent', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Join lobby', exact: true }).click();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(acks(page)).toHaveText(['room.join', 'state.sync']);
  await expect(page.getByRole('list', { name: 'Messages' }).getByRole('listitem')).toHaveCount(0);
});
