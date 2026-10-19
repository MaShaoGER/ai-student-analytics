import type { DatasetProfile } from "@/lib/analysis/types";
import type { SessionUser } from "@/lib/client-types";

export type ClientCapabilities = {
  canViewBusiness: boolean;
  canUseAI: boolean;
  canExport: boolean;
};

/**
 * Client-side presentation rules only. The API remains responsible for
 * authorization and must reject every operation independently of these flags.
 */
export function capabilitiesFor(user: SessionUser | null): ClientCapabilities {
  const canViewBusiness = Boolean(user && !user.mustChangePassword);
  return {
    canViewBusiness,
    canUseAI: canViewBusiness && (user?.role === "admin" || user?.role === "user"),
    canExport: canViewBusiness && (user?.role === "admin" || user?.role === "user"),
  };
}

export function isPasswordChangeRequired(user: SessionUser | null): boolean {
  return Boolean(user?.mustChangePassword);
}

/** A stable identity for clearing all client-visible state when access changes. */
export function sessionScopeKey(user: SessionUser | null): string {
  if (!user) return "anonymous";
  return JSON.stringify([
    user.id,
    user.role,
    [...(user.datasetIds ?? [])].sort(),
    Boolean(user.mustChangePassword),
  ]);
}

export function isDatasetEligible(profile: DatasetProfile): boolean {
  return profile.enabled !== false && profile.available;
}

/** The profile API is the authority for enabled/available and table metadata. */
export function datasetAccessKey(datasets: DatasetProfile[]): string {
  return JSON.stringify(
    [...datasets]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((dataset) => [
        dataset.id,
        dataset.enabled !== false,
        dataset.available,
        dataset.unavailableReason ?? null,
        [...dataset.tables]
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((table) => [table.name, table.status, table.rows]),
      ]),
  );
}
