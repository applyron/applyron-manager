export async function runWithConcurrencyLimit<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const workerCount = Math.max(1, Math.min(items.length, Math.floor(concurrency) || 1));
  let currentIndex = 0;

  const runners = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = currentIndex++;
      if (index >= items.length) {
        return;
      }

      await worker(items[index], index);
    }
  });

  await Promise.all(runners);
}
