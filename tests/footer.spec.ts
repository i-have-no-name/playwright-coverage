import { acks, expect, openApp, test } from './fixtures';

test('footer: quick reply without a room is ignored', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Quick OK' }).click();
  await expect(page.getByRole('list', { name: 'Messages' }).getByRole('listitem')).toHaveCount(0);
  await expect(acks(page)).toHaveCount(0);
});

test('footer: rejoin lobby', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Rejoin lobby' }).click();
  await expect(page.getByText('room: lobby')).toBeVisible();
  await expect(acks(page)).toHaveText(['room.join', 'state.sync']);
});
