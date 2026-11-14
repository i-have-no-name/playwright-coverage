import { acks, expect, openApp, test } from './fixtures';

test('header: refresh syncs state', async ({ page }) => {
  await openApp(page);
  await page.getByRole('banner').getByRole('button', { name: 'Refresh' }).click();
  await expect(acks(page)).toHaveText(['state.sync']);
});

test('header: change status to away', async ({ page }) => {
  await openApp(page);
  await page.getByRole('combobox', { name: 'Status' }).selectOption('away');
  await expect(page.getByText('status: away')).toBeVisible();
  await expect(acks(page)).toHaveText(['presence.update']);
});

test('header: go to support switches room', async ({ page }) => {
  await openApp(page);
  await page.getByRole('complementary').getByRole('button', { name: 'lobby' }).click();
  await expect(page.getByText('room: lobby')).toBeVisible();
  await page.getByRole('button', { name: 'Go to support' }).click();
  await expect(page.getByText('room: support')).toBeVisible();
  await expect(acks(page)).toContainText(['room.leave', 'room.join', 'state.sync']);
});
