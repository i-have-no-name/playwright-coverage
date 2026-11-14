import { acks, expect, openApp, test } from './fixtures';

test('sidebar: join room', async ({ page }) => {
  await openApp(page);
  await page.getByRole('complementary').getByRole('button', { name: 'support' }).click();
  await expect(page.getByText('room: support')).toBeVisible();
  await expect(acks(page)).toHaveText(['room.join', 'state.sync']);
});

test('sidebar: leave room', async ({ page }) => {
  await openApp(page);
  await page.getByRole('complementary').getByRole('button', { name: 'lobby' }).click();
  await page.getByRole('complementary').getByRole('button', { name: 'Leave' }).click();
  await expect(page.getByText('room: none')).toBeVisible();
  await expect(acks(page)).toHaveText(['room.join', 'state.sync', 'room.leave']);
});
