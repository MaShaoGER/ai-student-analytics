import { z } from "zod";
import { NextResponse } from "next/server";
import { apiError, assertSameOrigin, noStoreJson, requireAdmin } from "@/lib/auth/http";
import { createUser, listUsers, setUserDisabled } from "@/lib/auth/service";

export const runtime = "nodejs";
const createSchema = z
  .object({
    username: z.string().min(3).max(40),
    displayName: z.string().min(1).max(60),
    password: z.string().min(12).max(128),
    role: z.literal("user"),
  })
  .strict();
const updateSchema = z.object({ id: z.string().uuid(), disabled: z.boolean() }).strict();
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return noStoreJson({ users: listUsers() });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireAdmin(request);
    const user = await createUser(createSchema.parse(await request.json()));
    return NextResponse.json({ user }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    await requireAdmin(request);
    const input = updateSchema.parse(await request.json());
    return noStoreJson({ user: setUserDisabled(input.id, input.disabled) });
  } catch (error) {
    return apiError(error);
  }
}
