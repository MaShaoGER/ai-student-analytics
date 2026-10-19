import { z } from "zod";
import { NextResponse } from "next/server";
import { apiError, assertSameOrigin, noStoreJson, requireAdmin } from "@/lib/auth/http";
import {
  AuthError,
  createUser,
  listUsers,
  resetUserPassword,
  revokeUserSessions,
  updateUser,
} from "@/lib/auth/service";
import { readJsonBody } from "@/lib/security/request-body";

export const runtime = "nodejs";

const datasetIdsSchema = z.array(z.enum(["demo", "oulad"])).max(2);
const createSchema = z
  .object({
    username: z.string().trim().min(3).max(40),
    displayName: z.string().trim().min(1).max(60),
    password: z.string().min(12).max(128),
    role: z.enum(["user", "readonly"]),
    datasetIds: datasetIdsSchema,
  })
  .strict();
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reset-password"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("revoke-sessions"), id: z.string().uuid() }).strict(),
]);
const createOrActionSchema = z.union([actionSchema, createSchema]);
const updateSchema = z
  .object({
    id: z.string().uuid(),
    displayName: z.string().trim().min(1).max(60).optional(),
    role: z.enum(["user", "readonly"]).optional(),
    disabled: z.boolean().optional(),
    datasetIds: datasetIdsSchema.optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.displayName !== undefined ||
      input.role !== undefined ||
      input.disabled !== undefined ||
      input.datasetIds !== undefined,
    { message: "没有可更新的账号字段。" },
  );
const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(["admin", "user", "readonly"]).optional(),
  disabled: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

function queryValue(params: URLSearchParams, name: string): string | undefined {
  const value = params.get(name)?.trim();
  return value ? value : undefined;
}

function validateQueryKeys(params: URLSearchParams): void {
  const allowed = new Set(["q", "role", "disabled", "page", "pageSize"]);
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (!allowed.has(key)) throw new AuthError(400, "INVALID_QUERY", "包含未知的查询参数。");
    if (seen.has(key)) throw new AuthError(400, "INVALID_QUERY", "查询参数不能重复。");
    seen.add(key);
  }
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const params = new URL(request.url).searchParams;
    validateQueryKeys(params);
    const filter = querySchema.parse({
      q: queryValue(params, "q"),
      role: queryValue(params, "role"),
      disabled: queryValue(params, "disabled"),
      page: queryValue(params, "page"),
      pageSize: queryValue(params, "pageSize"),
    });
    return noStoreJson(listUsers(filter));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin(request);
    const input = createOrActionSchema.parse(await readJsonBody(request, { maxBytes: 16 * 1024 }));
    if ("action" in input) {
      if (input.action === "reset-password") {
        const result = await resetUserPassword(input.id, actor);
        return noStoreJson(result);
      }
      return noStoreJson({ user: revokeUserSessions(input.id, actor) });
    }
    return NextResponse.json(
      { user: await createUser(input, actor) },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin(request);
    const { id, ...input } = updateSchema.parse(await readJsonBody(request, { maxBytes: 16 * 1024 }));
    return noStoreJson({ user: updateUser(id, input, actor) });
  } catch (error) {
    return apiError(error);
  }
}
