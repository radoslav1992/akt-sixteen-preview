import type { APIRoute } from "astro";
import { getRecords } from "../lib/data";
import { rssFeed } from "../lib/feeds";

export const GET: APIRoute = () =>
  rssFeed({
    title: "Акт 16 Тракер — нови документи в София",
    description: "Нови удостоверения за въвеждане в експлоатация (Акт 16) и разрешения за строеж в София по данни от НАГ.",
    path: "/",
    items: [
      ...getRecords("act16").slice(0, 50).map((record) => ({ registerId: "act16" as const, record })),
      ...getRecords("permits").slice(0, 50).map((record) => ({ registerId: "permits" as const, record })),
    ],
  });
