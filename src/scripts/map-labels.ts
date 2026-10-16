// Basemap labels in Bulgarian: the OpenMapTiles styles show Latin and local names together.
type LabelMap = Pick<import("maplibre-gl").Map, "getStyle" | "getLayoutProperty" | "setLayoutProperty">;

export const BG_NAME = ["coalesce", ["get", "name:bg"], ["get", "name"]];

/** Points every name label at the Bulgarian (Cyrillic) name; house numbers and road refs stay as they are. */
export function localizeLabels(gl: LabelMap): void {
  for (const layer of gl.getStyle().layers) {
    if (layer.type !== "symbol") continue;
    const field = gl.getLayoutProperty(layer.id, "text-field");
    if (field && JSON.stringify(field).includes("name")) gl.setLayoutProperty(layer.id, "text-field", BG_NAME);
  }
}
