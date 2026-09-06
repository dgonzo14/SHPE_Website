import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/*
 * No timezone pinning here on purpose.
 *
 * Everything in lib/datetime formats through Intl with an explicit
 * `timeZone: "America/Chicago"`, so the assertions hold whatever zone CI runs
 * in. Setting process.env.TZ after Node has started would not reliably change
 * Date/Intl behaviour anyway — it would be reassurance, not a control.
 */

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
