import { describe, expect, it } from "vitest";
import {
  blankToNull,
  checkInSchema,
  emailDomainIssue,
  eventSchema,
  pointAdjustmentSchema,
  registerSchema,
  removeAttendanceSchema,
} from "../validation";

const CURRENT_YEAR = new Date().getFullYear();

const validRegistration = {
  first_name: "Ana",
  last_name: "Rivera",
  email: "ana.rivera@wustl.edu",
  password: "shpe-familia-2026",
  confirm_password: "shpe-familia-2026",
  major: "Computer Science",
  secondary_major: "",
  graduation_year: CURRENT_YEAR + 2,
  degree_level: "undergraduate" as const,
  shpe_national_member: false,
  shpe_national_member_id: "",
  linkedin_url: "",
};

describe("email domain policy", () => {
  it("accepts an approved domain", () => {
    expect(emailDomainIssue("ana@wustl.edu")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(emailDomainIssue("Ana@WUSTL.EDU")).toBeNull();
  });

  it("rejects an outside domain with an actionable message", () => {
    const issue = emailDomainIssue("ana@gmail.com");
    expect(issue).toContain("@wustl.edu");
    expect(issue).toContain("officer");
  });

  it("does not treat a lookalike subdomain as approved", () => {
    // wustl.edu.evil.com must not pass a naive "endsWith" style check.
    expect(emailDomainIssue("ana@wustl.edu.evil.com")).not.toBeNull();
  });
});

describe("registerSchema", () => {
  it("accepts a complete, valid registration", () => {
    expect(registerSchema.safeParse(validRegistration).success).toBe(true);
  });

  it("rejects mismatched passwords and points at the confirm field", () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      confirm_password: "something-else",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("confirm_password"))).toBe(true);
    }
  });

  /*
   * The domain is enforced by the database, not by this schema.
   * public.assert_email_domain_allowed() also consults manual_email_allowlist,
   * which the browser cannot see, so a blocking check here would veto
   * registrations the server would have accepted. emailDomainIssue() still
   * flags the address for the form to show as advice -- asserted below so the
   * warning cannot be dropped without a test failing.
   */
  it("accepts an off-domain address and defers the decision to the server", () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      email: "ana@gmail.com",
    });
    expect(result.success).toBe(true);
  });

  it("still surfaces an off-domain address as advice", () => {
    expect(emailDomainIssue("ana@gmail.com")).not.toBeNull();
  });

  /*
   * z.url() on its own accepts javascript:, data: and vbscript: -- they are
   * well-formed URLs. linkedin_url and announcement external_url are rendered
   * into href attributes, so the protocol restriction is the control, not the
   * URL shape.
   */
  it("rejects a URL whose protocol is not http or https", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
    ]) {
      const result = registerSchema.safeParse({ ...validRegistration, linkedin_url: bad });
      expect(result.success, `expected ${bad} to be rejected`).toBe(false);
    }
  });

  it("still accepts an ordinary https profile link", () => {
    expect(
      registerSchema.safeParse({
        ...validRegistration,
        linkedin_url: "https://linkedin.com/in/diego",
      }).success,
    ).toBe(true);
  });

  it("rejects a short password", () => {
    expect(
      registerSchema.safeParse({
        ...validRegistration,
        password: "short",
        confirm_password: "short",
      }).success,
    ).toBe(false);
  });

  it("rejects an implausible graduation year", () => {
    expect(
      registerSchema.safeParse({ ...validRegistration, graduation_year: 1975 }).success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({ ...validRegistration, graduation_year: CURRENT_YEAR + 40 })
        .success,
    ).toBe(false);
  });

  it("has no way to request a role", () => {
    // Registration must not be able to assign privileges. The database ignores
    // anything but the known metadata keys, and the schema does not offer one.
    const parsed = registerSchema.parse(validRegistration);
    expect(Object.keys(parsed)).not.toContain("role");
    expect(Object.keys(parsed)).not.toContain("membership_status");
  });
});

describe("eventSchema", () => {
  const base = {
    title: "Boeing Networking Night",
    description: "",
    category_id: "5ec3f0e2-2d6e-4a2f-9f1f-7ad2f1a6a111",
    location: "Knight Hall",
    start_at: "2026-09-18T18:30",
    end_at: "2026-09-18T20:00",
    check_in_opens_at: "2026-09-18T18:00",
    check_in_closes_at: "2026-09-18T20:30",
    points_value: 15,
    capacity: undefined,
    status: "published" as const,
    is_public: true,
    organizer_name: "",
    organizer_email: "",
    image_url: "",
  };

  it("accepts a well-formed event", () => {
    expect(eventSchema.safeParse(base).success).toBe(true);
  });

  it("requires the end to be after the start", () => {
    const result = eventSchema.safeParse({ ...base, end_at: "2026-09-18T18:00" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("end_at"))).toBe(true);
    }
  });

  it("rejects a check-in window that closes before it opens", () => {
    const result = eventSchema.safeParse({
      ...base,
      check_in_opens_at: "2026-09-18T20:00",
      check_in_closes_at: "2026-09-18T18:00",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("check_in_closes_at"))).toBe(true);
    }
  });

  it("rejects negative points", () => {
    expect(eventSchema.safeParse({ ...base, points_value: -5 }).success).toBe(false);
  });

  it("requires a category", () => {
    expect(eventSchema.safeParse({ ...base, category_id: "" }).success).toBe(false);
  });

  it("requires a title that is not just whitespace", () => {
    expect(eventSchema.safeParse({ ...base, title: "   " }).success).toBe(false);
  });
});

describe("check-in code entry", () => {
  it("accepts a normal code", () => {
    expect(checkInSchema.safeParse({ code: "NOVA4821" }).success).toBe(true);
  });

  it("trims surrounding whitespace before length checks", () => {
    const result = checkInSchema.safeParse({ code: "  NOVA4821  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.code).toBe("NOVA4821");
  });

  it("rejects something far too short to be a code", () => {
    expect(checkInSchema.safeParse({ code: "ab" }).success).toBe(false);
  });
});

describe("administrative corrections", () => {
  it("requires a non-zero adjustment", () => {
    expect(pointAdjustmentSchema.safeParse({ amount: 0, reason: "typo" }).success).toBe(false);
  });

  it("allows a negative adjustment", () => {
    expect(
      pointAdjustmentSchema.safeParse({ amount: -10, reason: "Duplicate attendance" }).success,
    ).toBe(true);
  });

  it("requires a reason, because the audit log records it", () => {
    expect(pointAdjustmentSchema.safeParse({ amount: 10, reason: "" }).success).toBe(false);
    expect(removeAttendanceSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(removeAttendanceSchema.safeParse({ reason: "Checked in by mistake" }).success).toBe(
      true,
    );
  });
});

describe("blankToNull", () => {
  it("maps empty and whitespace-only input to null", () => {
    expect(blankToNull("")).toBeNull();
    expect(blankToNull("   ")).toBeNull();
    expect(blankToNull(undefined)).toBeNull();
    expect(blankToNull(null)).toBeNull();
  });

  it("trims values it keeps", () => {
    expect(blankToNull("  Lopata Hall  ")).toBe("Lopata Hall");
  });
});
