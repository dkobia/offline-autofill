import { describe, expect, it } from "vitest";
import { PROFILE_KEYS, describeKeys, fieldSpec, isProfileKey } from "./keys";
import { answerOf, emptyProfile, entryCount, isProfileEmpty, normalizeProfile, resolveValue } from "./schema";

describe("profile keys", () => {
  it("derives dotted keys from every section", () => {
    expect(PROFILE_KEYS).toContain("identity.firstName");
    expect(PROFILE_KEYS).toContain("education.institution");
    expect(PROFILE_KEYS).toContain("employment.description");
    expect(new Set(PROFILE_KEYS).size).toBe(PROFILE_KEYS.length);
  });

  it("recognizes only known keys", () => {
    expect(isProfileKey("contact.email")).toBe(true);
    expect(isProfileKey("contact.fax")).toBe(false);
    expect(isProfileKey(42)).toBe(false);
  });

  it("describes every key for the prompt", () => {
    const described = describeKeys();
    expect(described).toHaveLength(PROFILE_KEYS.length);
    expect(described.find((d) => d.key === "address.city")).toEqual({
      key: "address.city",
      description: "City or town",
      repeating: true,
    });
    expect(fieldSpec("identity.fullName").derived).toBe(true);
  });
});

describe("normalizeProfile", () => {
  it("returns an empty profile for garbage", () => {
    expect(normalizeProfile(null)).toEqual(emptyProfile());
    expect(normalizeProfile("nope")).toEqual(emptyProfile());
    expect(isProfileEmpty(normalizeProfile({}))).toBe(true);
  });

  it("keeps known fields, trims, and drops blanks and unknowns", () => {
    const profile = normalizeProfile({
      identity: { firstName: "  Ada ", lastName: "Lovelace", fullName: "ignored", nickname: "x" },
      contact: { email: "", phone: 12345 },
      address: [{ city: "London" }, { line1: "" }, "junk"],
      education: "not a list",
    });
    expect(profile.identity).toEqual({ firstName: "Ada", lastName: "Lovelace" });
    expect(profile.contact).toEqual({});
    expect(profile.address).toEqual([{ city: "London" }]);
    expect(profile.education).toEqual([]);
    expect(isProfileEmpty(profile)).toBe(false);
  });
});

describe("resolveValue", () => {
  const profile = normalizeProfile({
    identity: { firstName: "Ada", lastName: "Lovelace" },
    education: [{ institution: "Home" }, { institution: "Royal Society" }],
  });

  it("resolves plain and repeating keys", () => {
    expect(resolveValue(profile, "identity.firstName")).toBe("Ada");
    expect(resolveValue(profile, "education.institution")).toBe("Home");
    expect(resolveValue(profile, "education.institution", 1)).toBe("Royal Society");
    expect(resolveValue(profile, "education.institution", 2)).toBeUndefined();
    expect(resolveValue(profile, "contact.email")).toBeUndefined();
  });

  it("derives the full name", () => {
    expect(resolveValue(profile, "identity.fullName")).toBe("Ada Lovelace");
    expect(resolveValue(emptyProfile(), "identity.fullName")).toBeUndefined();
  });

  it("counts entries", () => {
    expect(entryCount(profile, "education")).toBe(2);
    expect(entryCount(profile, "identity")).toBe(1);
    expect(entryCount(profile, "contact")).toBe(0);
  });
});

describe("saved answers in the profile", () => {
  it("normalizes the list, counts it as content, and resolves answer keys", () => {
    const profile = normalizeProfile({ answers: [{ id: "a1", question: "Why?", answer: "Because." }, { id: "x", question: "", answer: "y" }] });
    expect(profile.answers).toEqual([{ id: "a1", question: "Why?", answer: "Because." }]);
    expect(isProfileEmpty(profile)).toBe(false);
    expect(resolveValue(profile, "answer.a1")).toBe("Because.");
    expect(resolveValue(profile, "answer.a1", 3)).toBe("Because.");
    expect(resolveValue(profile, "answer.zz")).toBeUndefined();
    expect(answerOf(profile, "answer.a1")?.question).toBe("Why?");
    expect(answerOf(profile, "contact.email")).toBeUndefined();
    expect(emptyProfile().answers).toEqual([]);
    expect(normalizeProfile({ identity: { firstName: "Ada" } }).answers).toEqual([]);
  });
});
