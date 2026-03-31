import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SAMPLE_API_RESPONSE = {
  Data: [
    {
      Number: "100/15.03.2026",
      Hash: "abc123",
      DocumentTypeName: "Удостоверение за въвеждане в експлоатация на строеж",
      Status: null,
      TakeEffect: { DateTime: null, FilterText: null },
      Issuer: "Кмет на район Лозенец",
      Employer: "",
      ConstructionalOversightName: '"Стройконтрол" ЕООД',
      Object: "Жилищна сграда с подземен гараж",
      Region: "Лозенец",
      Scope: "Местност: Лозенец, Адрес: ул. Тинтява 15",
    },
    {
      Number: "99/14.03.2026",
      Hash: "def456",
      DocumentTypeName: "Разрешение за строеж",
      Status: "Влязъл в сила",
      TakeEffect: { DateTime: "2026-03-20", FilterText: null },
      Issuer: "Главен архитект на СО - р-н \"Младост\"",
      Employer: '"ГРУП-7" ЕООД',
      ConstructionalOversightName: "",
      Object: "Многофамилна жилищна сграда с подземен гараж",
      Region: "Младост",
      Scope: "Адрес: бул. Александър Малинов 51",
    },
  ],
  Total: 2,
};

describe("normalizeRecord", () => {
  let normalizeRecord;

  beforeEach(async () => {
    const mod = await import("../scripts/scrape.mjs");
    normalizeRecord = mod.normalizeRecord;
  });

  it("splits Number into number and date", () => {
    const result = normalizeRecord({
      Number: "100/15.03.2026",
      Object: "Test",
      Region: "Лозенец",
    });
    expect(result.number).toBe("100");
    expect(result.date).toBe("15.03.2026");
  });

  it("handles missing fields gracefully", () => {
    const result = normalizeRecord({ Number: "", Object: "", Region: "" });
    expect(result.number).toBe("");
    expect(result.region).toBe("");
    expect(result.employer).toBe("");
  });

  it("preserves all fields from Act 16 response", () => {
    const result = normalizeRecord(SAMPLE_API_RESPONSE.Data[0]);
    expect(result.issuer).toBe("Кмет на район Лозенец");
    expect(result.constructionOversight).toBe('"Стройконтрол" ЕООД');
    expect(result.object).toBe("Жилищна сграда с подземен гараж");
    expect(result.scope).toContain("Тинтява");
  });

  it("preserves employer field from building permits", () => {
    const result = normalizeRecord(SAMPLE_API_RESPONSE.Data[1]);
    expect(result.employer).toBe('"ГРУП-7" ЕООД');
    expect(result.documentType).toBe("Разрешение за строеж");
    expect(result.region).toBe("Младост");
  });

  it("handles null status and takeEffect", () => {
    const result = normalizeRecord(SAMPLE_API_RESPONSE.Data[0]);
    expect(result.status).toBeNull();
    expect(result.takeEffect).toBeNull();
  });

  it("preserves non-null status", () => {
    const result = normalizeRecord(SAMPLE_API_RESPONSE.Data[1]);
    expect(result.status).toBe("Влязъл в сила");
    expect(result.takeEffect).toBe("2026-03-20");
  });
});

describe("REGISTERS config", () => {
  it("defines act16 and permits with correct paths", async () => {
    const { REGISTERS } = await import("../scripts/scrape.mjs");
    expect(REGISTERS.act16).toBeDefined();
    expect(REGISTERS.permits).toBeDefined();
    expect(REGISTERS.act16.readPath).toContain("ExploitationBuildings");
    expect(REGISTERS.permits.readPath).toContain("BuildingPermits");
  });
});

const DATA_FILES = [
  { file: "certificates.json", key: "certificates" },
  { file: "permits.json", key: "permits" },
];

const REQUIRED_FIELDS = [
  "number",
  "date",
  "documentType",
  "issuer",
  "object",
  "region",
  "scope",
];

describe.each(DATA_FILES)("data integrity: $file", ({ file, key }) => {
  let data;

  beforeEach(() => {
    data = JSON.parse(
      readFileSync(resolve(__dirname, "..", "data", file), "utf-8")
    );
  });

  it("has valid structure", () => {
    expect(data).toHaveProperty("lastUpdated");
    expect(data).toHaveProperty("total");
    expect(data).toHaveProperty(key);
    expect(Array.isArray(data[key])).toBe(true);
    expect(data.total).toBe(data[key].length);
  });

  it("each record has required fields", () => {
    data[key].forEach((record) => {
      REQUIRED_FIELDS.forEach((field) => {
        expect(record).toHaveProperty(field);
      });
    });
  });

  it("dates are in DD.MM.YYYY format", () => {
    const dateRegex = /^\d{2}\.\d{2}\.\d{4}$/;
    data[key].forEach((record) => {
      expect(record.date).toMatch(dateRegex);
    });
  });

  it("records are sorted by date descending", () => {
    const parseDate = (s) => {
      const [d, m, y] = s.split(".");
      return new Date(+y, +m - 1, +d);
    };

    for (let i = 1; i < data[key].length; i++) {
      const prev = parseDate(data[key][i - 1].date);
      const curr = parseDate(data[key][i].date);
      expect(prev.getTime()).toBeGreaterThanOrEqual(curr.getTime());
    }
  });
});

describe("searchQueryId extraction", () => {
  it("regex extracts searchQueryId from HTML", () => {
    const html = '<form action="/Search?searchQueryId=abc-123-def">';
    const regex = /searchQueryId=([a-f0-9-]+)/;
    const match = html.match(regex);
    expect(match).not.toBeNull();
    expect(match[1]).toBe("abc-123-def");
  });
});
