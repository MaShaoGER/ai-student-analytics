/**
 * Scroll windows as fractions of a stage's scroll progress, staggered by course index.
 * Bars finish growing inside the 01 stage. In the 02 stage each link draws, its ■ lands at the
 * window end, then that course's dumbbell opens toward ○ in the following tenth.
 */
export const barWindow = (index: number): [number, number] => [index * 0.12, 0.55 + index * 0.12];
export const linkWindow = (index: number): [number, number] => [index * 0.1, 0.6 + index * 0.1];
