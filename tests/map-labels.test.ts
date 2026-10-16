import { describe, expect, it } from "vitest";
import { BG_NAME, localizeLabels } from "../src/scripts/map-labels";

describe("basemap labels", () => {
  it("switches name labels to Bulgarian and leaves refs and house numbers alone", () => {
    const layout: { [id: string]: unknown } = {
      place: "{name:latin}\n{name:nonlatin}",
      street: ["get", "name"],
      shield: "{ref}",
      housenumber: "{housenumber}",
    };
    const layers = [
      { id: "water", type: "fill" },
      ...Object.keys(layout).map((id) => ({ id, type: "symbol" })),
    ];
    const gl = {
      getStyle: () => ({ layers }),
      getLayoutProperty: (id: string) => layout[id],
      setLayoutProperty: (id: string, _prop: string, value: unknown) => void (layout[id] = value),
    };
    localizeLabels(gl as never);
    expect(layout).toEqual({ place: BG_NAME, street: BG_NAME, shield: "{ref}", housenumber: "{housenumber}" });
  });
});
