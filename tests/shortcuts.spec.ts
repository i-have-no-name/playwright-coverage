import { acks, expect, openApp, test } from './fixtures';

test('shortcut: r refreshes', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('r');
  await expect(acks(page)).toHaveText(['state.sync']);
});

test('shortcut: Escape leaves room', async ({ page }) => {
  await openApp(page);
  await page.getByRole('complementary').getByRole('button', { name: 'lobby' }).click();
  await expect(page.getByText('room: lobby')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('room: none')).toBeVisible();
  await expect(acks(page)).toContainText(['room.leave']);
});
