import type { APIRoute, GetStaticPaths } from "astro";
import { getRecords, type RegisterId } from "../../lib/data";
import { csvExport } from "../../lib/feeds";

export const getStaticPaths: GetStaticPaths = () => [{ params: { id: "act16" } }, { params: { id: "permits" } }];

export const GET: APIRoute = ({ params }) => csvExport(params.id as RegisterId, getRecords(params.id as RegisterId));
