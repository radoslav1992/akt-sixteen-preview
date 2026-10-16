import { describe, expect, it } from "vitest";
import { readableCase } from "../src/lib/textcase";

describe("readableCase", () => {
  it("keeps names, numerals and abbreviations readable", () => {
    expect(readableCase("РЕКОНСТРУКЦИЯ НА ЕДНОФАМИЛНА ЖИЛИЩНА СГРАДА В УПИ II-104, КВ. 3, В.З. БУНКЕРА, Р-Н ПАНЧАРЕВО, ГР. СОФИЯ"))
      .toBe("Реконструкция на еднофамилна жилищна сграда в УПИ II-104, кв. 3, в.з. Бункера, р-н Панчарево, гр. София");
    expect(readableCase("МНОГОФАМИЛНА ЖИЛИЩНА СГРАДА С ГАРАЖИ, ЖК \"МЛАДОСТ 1\", УЛ. ХРИСТО СМИРНЕНСКИ"))
      .toBe("Многофамилна жилищна сграда с гаражи, жк \"Младост 1\", ул. Христо смирненски");
  });

  it("does not treat abbreviations as sentence ends", () => {
    expect(readableCase("МНОГОФАМИЛНА ЖИЛИЩНА СГРАДА С К.К. ДО 12 М. И ГАРАЖИ")).toBe("Многофамилна жилищна сграда с к.к. до 12 м. и гаражи");
  });

  it("leaves mixed-case text untouched", () => {
    expect(readableCase("Еднофамилна жилищна сграда на калкан")).toBe("Еднофамилна жилищна сграда на калкан");
  });
});
