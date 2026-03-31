import type { APIRoute, GetStaticPaths } from "astro";
import { getRecords, type RegisterId, type Record } from "../../lib/data";

const MAX_OBJECT_LEN = 200;
const MAX_SCOPE_LEN = 120;
const MAX_META_LEN = 80;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function toClientRecord(r: Record, registerId: RegisterId) {
  const meta =
    registerId === "permits" ? r.employer : r.constructionOversight;
  return {
    n: r.number,
    d: r.date,
    o: truncate(r.object, MAX_OBJECT_LEN),
    r: r.region,
    m: truncate(meta, MAX_META_LEN),
    s: truncate(r.scope, MAX_SCOPE_LEN),
  };
}

export const getStaticPaths: GetStaticPaths = () => [
  { params: { id: "act16" } },
  { params: { id: "permits" } },
];

export const GET: APIRoute = ({ params }) => {
  const registerId = params.id as RegisterId;
  const records = getRecords(registerId);
  const payload = records.map((r) => toClientRecord(r, registerId));

  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
  });
};
