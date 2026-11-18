import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const faq = z.array(z.object({ q: z.string(), a: z.string() })).optional();

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    /** Full <title> for search results when it should differ from the H1 (≤ 60 characters, no suffix added). */
    seoTitle: z.string().max(60).optional(),
    description: z.string(),
    date: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    image: z.string().optional(),
    faq,
  }),
});

// English and Russian guides for foreign buyers; rendered under /en/ and /ru/.
const intl = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/intl" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    lang: z.enum(["en", "ru"]),
    slug: z.string(),
    tags: z.array(z.string()).default([]),
    faq,
  }),
});

export const collections = { blog, intl };
