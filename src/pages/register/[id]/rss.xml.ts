import type { APIRoute, GetStaticPaths } from "astro";
import { getRecords, getRegister, type RegisterId } from "../../../lib/data";
import { rssFeed } from "../../../lib/feeds";

export const getStaticPaths: GetStaticPaths = () => [{ params: { id: "act16" } }, { params: { id: "permits" } }];

export const GET: APIRoute = ({ params }) => {
  const registerId = params.id as RegisterId;
  return rssFeed({
    title: `${getRegister(registerId).label} — София`,
    description: `Най-новите записи в регистъра „${getRegister(registerId).label}“ на Столична община.`,
    path: `/register/${registerId}/`,
    items: getRecords(registerId).slice(0, 50).map((record) => ({ registerId, record })),
  });
};
