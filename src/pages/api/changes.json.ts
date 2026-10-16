import type { APIRoute } from "astro";
import changes from "../../../data/changes.json";

// When each document first appeared in the registers (the scraper's change log, last 60 days).
// The account page uses it for accurate "new since your last visit" counts.
export const GET: APIRoute = () => new Response(JSON.stringify(changes), { headers: { "Content-Type": "application/json" } });
