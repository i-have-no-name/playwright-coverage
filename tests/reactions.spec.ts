import { acks, expect, openApp, test } from './fixtures';

test('reactions: thumbs up is sent, then cleared by the saga', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Thumbs up' }).click();
  await expect(page.getByText('reaction: thumbs-up')).toBeVisible();
  await expect(acks(page)).toHaveText(['reaction.add', 'reaction.clear']);
  await expect(page.getByText('reaction: none')).toBeVisible();
});

test('reactions: clear button', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Clear reaction' }).click();
  await expect(acks(page)).toHaveText(['reaction.clear']);
});
