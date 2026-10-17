/** Keep the same subject colors in the panorama and chord, independent of display order. */
export function courseColorTokens(courses: readonly string[]) {
  return new Map(
    [...new Set(courses)]
      .sort()
      .map((name, index) => [name, `--chart-multi-category-${(index % 12) + 1}`]),
  );
}
