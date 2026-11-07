"use client";

import { useEffect, useRef } from "react";
import { mountHomeNeuralScene } from "./home-neural-scene";
import styles from "./home-neural-artwork.module.css";

/** Pure decoration: no course data, controls, focus stops or instructional copy. */
export function HomeNeuralArtwork({ animated }: { animated: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current) return mountHomeNeuralScene(svgRef.current, animated);
  }, [animated]);

  return (
    <svg
      ref={svgRef}
      className={styles.scene}
      viewBox="0 0 817 560"
      fill="none"
      aria-hidden="true"
      focusable="false"
      data-home-neural=""
    />
  );
}
