/** Locally rendered backgrounds; smoke is the user's selected direction. */
export const glassPatterns = [
  {
    id: "smoke",
    code: "03",
    name: "烟银玻璃",
    description: "黑色留白中舒展的银灰曲面，宽阔反射与少量边缘色散。",
    note: "当前选定方向 · 烟银曲面",
    value: 5,
  },
  {
    id: "contours",
    code: "A",
    name: "矿物等高线",
    description: "层叠的矿物切面与缓慢起伏的地形线，灰紫、琥珀相间。",
    note: "纹理更丰富 · 接近参考图",
    value: 1,
  },
  {
    id: "water",
    code: "B",
    name: "浅海水光",
    description: "青绿水面下交织的柔光，像阳光穿过水波。",
    note: "清透自然 · 色彩更克制",
    value: 2,
  },
  {
    id: "aurora",
    code: "C",
    name: "极光帷幕",
    description: "纵向舒展的极光与丝绸褶皱，深绿中带一点蓝紫。",
    note: "方向更柔和 · 适合长时间使用",
    value: 3,
  },
  {
    id: "ripples",
    code: "D",
    name: "同心波纹",
    description: "偏心圆环相互干涉，细密的银蓝波纹带出空间深度。",
    note: "秩序感更强 · 偏理性科技",
    value: 4,
  },
] as const;

export type GlassPattern = "ribbons" | (typeof glassPatterns)[number]["id"];
export const glassPatternValue = (pattern: GlassPattern) =>
  glassPatterns.find((item) => item.id === pattern)?.value ?? 0;
