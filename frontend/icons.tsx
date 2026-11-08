import { Canvas, Path2D } from "nsh";
const paths: Record<string, string> = {
  Overview: "M3 11L12 3L21 11M5 10V21H19V10M10 21V14H14V21",
  Stock: "M4 4H20V20H4ZM4 10H20M9 4V10M9 15H15",
  Shopping: "M3 4H5L8 16H19L22 7H6M9 20H10M17 20H18",
  Meals: "M5 3V9M9 3V9M5 7H9M7 9V21M17 3V21M17 3C22 7 22 11 17 12",
  Chores: "M8 4H4V21H20V4H16M8 2H16V6H8ZM8 12L10 14L16 10M8 18H16",
  Settings:
    "M12 3V6M12 18V21M3 12H6M18 12H21M5 5L7 7M17 17L19 19M5 19L7 17M17 7L19 5M12 8A4 4 0 1 1 11.99 8",
  Batch:
    "M3 3H9M3 3V9M21 3H15M21 3V9M3 21H9M3 21V15M21 21H15M21 21V15M8 8V16M11 8V16M15 8V16M17 8V16",
};
/** Small consistent line icons rendered by NSH on every target. */
export function NavIcon(p: { name: string; color: string }) {
  return (
    <Canvas
      class="w-6 h-6 shrink-0"
      draw={(cx) => {
        cx.strokeStyle = p.color;
        cx.lineWidth = 1.7;
        cx.lineCap = "round";
        cx.lineJoin = "round";
        cx.stroke(new Path2D(paths[p.name] ?? paths.Stock));
      }}
    />
  );
}
