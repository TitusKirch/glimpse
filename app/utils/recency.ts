// The shared mechanics of a "recent list": move (or insert) `item` to the
// front, de-duplicate by a stable key, then cap to `max` entries. Pure and
// store-free, so it is the test surface and every recency list (recent repos,
// recently-used command-palette actions) reuses one implementation instead of
// each store restating the move-to-front/dedup/trim algorithm. The cap policy
// stays with the caller (the settings store), passed in as `max`.

export function moveToFront<T>({
  list,
  item,
  key,
  max
}: {
  list: T[];
  item: T;
  key: (entry: T) => string;
  max: number;
}): T[] {
  const id = key(item);
  return [item, ...list.filter((entry) => key(entry) !== id)].slice(
    0,
    Math.max(0, max)
  );
}
