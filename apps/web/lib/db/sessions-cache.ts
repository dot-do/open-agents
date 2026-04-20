import { cache } from "react";
import { getSessionById, getShareById } from "./sessions";

export const getSessionByIdCached = cache(async (sessionId: string, tenantId?: string) =>
  getSessionById(sessionId, tenantId),
);

export const getShareByIdCached = cache(async (shareId: string) =>
  getShareById(shareId),
);
