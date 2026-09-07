/**
 * Every React Query key in the app, built here so invalidation after a mutation
 * is precise. A successful check-in has to refresh points, history, the event's
 * own attendance state and the dashboard — that is only reliable if the keys
 * are constructed in one place rather than typed out at each call site.
 */

export const queryKeys = {
  appConfig: ["app-config"] as const,

  terms: {
    all: ["terms"] as const,
    active: ["terms", "active"] as const,
  },

  eventCategories: ["event-categories"] as const,

  events: {
    all: ["events"] as const,
    list: (filters: Record<string, unknown>) => ["events", "list", filters] as const,
    detail: (eventId: string) => ["events", "detail", eventId] as const,
    attendance: (eventId: string) => ["events", "attendance", eventId] as const,
    codeStatus: (eventId: string) => ["events", "code-status", eventId] as const,
  },

  member: {
    dashboard: (termId: string | null) => ["member", "dashboard", termId] as const,
    points: (memberId: string, scope: string) => ["member", memberId, "points", scope] as const,
    transactions: (memberId: string, scope: string) =>
      ["member", memberId, "transactions", scope] as const,
    attendance: (memberId: string, scope: string) =>
      ["member", memberId, "attendance", scope] as const,
    profile: (memberId: string) => ["member", memberId, "profile"] as const,
    roles: (memberId: string) => ["member", memberId, "roles"] as const,
  },

  announcements: {
    active: ["announcements", "active"] as const,
    all: ["announcements", "all"] as const,
  },

  resources: {
    visible: ["resources", "visible"] as const,
    all: ["resources", "all"] as const,
  },

  admin: {
    members: (filters: Record<string, unknown>) => ["admin", "members", filters] as const,
    memberDetail: (memberId: string) => ["admin", "members", memberId] as const,
    attendanceFeed: ["admin", "attendance-feed"] as const,
    analytics: (termId: string | null) => ["admin", "analytics", termId] as const,
    auditLog: (filters: Record<string, unknown>) => ["admin", "audit-log", filters] as const,
  },
} as const;
