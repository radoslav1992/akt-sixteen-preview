import type { APIRoute, GetStaticPaths } from "astro";
import { getAllRegionsWithSlugs, getRegionRecords } from "../../../lib/data";
import { rssFeed } from "../../../lib/feeds";

export const getStaticPaths: GetStaticPaths = () =>
  getAllRegionsWithSlugs().map((r) => ({ params: { slug: r.slug }, props: { name: r.name } }));

export const GET: APIRoute = ({ params, props }) => {
  const { act16, permits } = getRegionRecords(props.name as string);
  return rssFeed({
    title: `Район ${props.name} — Акт 16 и разрешения за строеж`,
    description: `Нови документи за строежи в район ${props.name}, София.`,
    path: `/region/${params.slug}/`,
    items: [
      ...act16.slice(0, 50).map((record) => ({ registerId: "act16" as const, record })),
      ...permits.slice(0, 50).map((record) => ({ registerId: "permits" as const, record })),
    ],
  });
};
