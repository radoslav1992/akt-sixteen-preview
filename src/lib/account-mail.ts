// Account emails sent from API routes (verification and password reset).
import { createEmailToken } from "./auth";
import { resetEmail, sendMail, verifyEmail, type MailEnv, type SendResult } from "./email";

export async function sendVerification(db: D1Database, env: MailEnv, userId: number, email: string): Promise<SendResult> {
  const token = await createEmailToken(db, userId, "verify");
  return sendMail(env, { to: email, ...verifyEmail(token) });
}

export async function sendPasswordReset(db: D1Database, env: MailEnv, userId: number, email: string): Promise<SendResult> {
  const token = await createEmailToken(db, userId, "reset");
  return sendMail(env, { to: email, ...resetEmail(token) });
}

/** Lets a response return before slow work (sending email) finishes. */
export function background(locals: unknown, task: Promise<unknown>): void {
  const ctx = (locals as { cfContext?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined)?.cfContext;
  if (ctx?.waitUntil) ctx.waitUntil(task.catch((e) => console.error("[background]", e)));
  else task.catch((e) => console.error("[background]", e));
}
