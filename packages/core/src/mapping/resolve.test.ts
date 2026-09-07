import { describe, expect, it, vi } from "vitest";
import { loadFixture } from "../fixtures.test-util";
import { collectFields } from "../forms/collect";
import { resolveMappings, type FieldMapper } from "./resolve";

describe("resolveMappings", () => {
  const fields = collectFields(loadFixture("job-application.html"));

  it("works without a mapper", async () => {
    const result = await resolveMappings(fields);
    expect(result.usedModel).toBe(false);
    expect(result.unmapped.map((f) => f.name)).toEqual(["pronouns", "motivation"]);
    expect(result.mappings.length).toBeGreaterThan(10);
  });

  it("sends only the leftovers to the mapper and merges its answer", async () => {
    const mapper: FieldMapper = {
      name: "fake",
      mapFields: vi.fn(async (leftovers) => [
        { ref: leftovers[1]!.ref, key: "employment.description", entry: 0, source: "model", confidence: 0.6 },
      ]),
    };
    const result = await resolveMappings(fields, mapper);
    expect(result.usedModel).toBe(true);
    expect(mapper.mapFields).toHaveBeenCalledOnce();
    const sent = (mapper.mapFields as ReturnType<typeof vi.fn>).mock.calls[0]![0] as typeof fields;
    expect(sent.map((f) => f.name)).toEqual(["pronouns", "motivation"]);
    expect(result.unmapped.map((f) => f.name)).toEqual(["pronouns"]);
    expect(result.mappings.some((m) => m.source === "model" && m.key === "employment.description")).toBe(true);
  });

  it("discards model answers for fields it was not asked about or keys that do not fit the control", async () => {
    const motivation = fields.find((f) => f.name === "motivation")!;
    const mapper: FieldMapper = {
      name: "fake",
      mapFields: async () => [
        { ref: motivation.ref, key: "employment.title", entry: 0, source: "model", confidence: 0.6 },
        { ref: "#not-a-field", key: "contact.email", entry: 0, source: "model", confidence: 0.6 },
      ],
    };
    const result = await resolveMappings(fields, mapper);
    expect(result.mappings.some((m) => m.source === "model")).toBe(false);
    expect(result.unmapped.map((f) => f.name)).toEqual(["pronouns", "motivation"]);
  });

  it("refuses the address country for a phone group's dialing-code selector, from the model as from the rules", async () => {
    const ats = collectFields(loadFixture("ats-application.html"));
    const country = ats.find((f) => f.id === "country")!;
    const mapper: FieldMapper = {
      name: "fake",
      mapFields: async () => [{ ref: country.ref, key: "address.country", entry: 0, source: "model", confidence: 0.6 }],
    };
    const result = await resolveMappings(ats, mapper);
    expect(result.mappings.some((m) => m.ref === country.ref)).toBe(false);
    expect(result.unmapped.map((f) => f.id)).toContain("country");
  });

  it("never offers blocked or invisible fields to anyone", async () => {
    const login = collectFields(loadFixture("hidden-fields.html"));
    const mapper: FieldMapper = { name: "fake", mapFields: vi.fn(async () => []) };
    const result = await resolveMappings(login, mapper);
    expect(result.blocked.map((f) => f.name)).toEqual(["pass", "card", "ssn"]);
    const offered = new Set([
      ...result.mappings.map((m) => m.ref),
      ...result.unmapped.map((f) => f.ref),
      ...((mapper.mapFields as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as typeof login | undefined ?? []).map((f) => f.ref),
    ]);
    const byRef = new Map(login.map((f) => [f.ref, f]));
    for (const ref of offered) {
      const field = byRef.get(ref)!;
      expect(field.visible, field.name).toBe(true);
      expect(field.editable, field.name).toBe(true);
    }
    expect(offered.has(byRef.get("#trap-email")!.ref)).toBe(false);
  });
});

describe("resolveMappings with saved answers", () => {
  const fields = collectFields(loadFixture("job-application.html"));
  const answers = [
    { key: "answer.a1" as const, question: "Why do you want to work here?", multiline: true as const },
    { key: "answer.a2" as const, question: "Pronouns" },
  ];

  it("maps by the rules first and hands the mapper the questions, never an answer", async () => {
    const mapper: FieldMapper = { name: "fake", mapFields: vi.fn(async () => []) };
    const result = await resolveMappings(fields, mapper, { answers });
    expect(result.mappings.find((m) => m.key === "answer.a1")).toMatchObject({ source: "heuristic", confidence: 0.95 });
    expect(result.unmapped.map((f) => f.name)).toEqual(["pronouns"]);
    const [sent, options] = (mapper.mapFields as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((sent as typeof fields).map((f) => f.name)).toEqual(["pronouns"]);
    expect(options).toEqual({ answers });
  });

  it("filters the mapper's answer keys by fit like any other key", async () => {
    const pronouns = fields.find((f) => f.name === "pronouns")!;
    const mapper: FieldMapper = {
      name: "fake",
      mapFields: async () => [{ ref: pronouns.ref, key: "answer.a1", entry: 0, source: "model", confidence: 0.6 }],
    };
    const dropped = await resolveMappings(fields, mapper, { answers });
    expect(dropped.mappings.some((m) => m.source === "model")).toBe(false);
    const fits: FieldMapper = {
      name: "fake",
      mapFields: async () => [{ ref: pronouns.ref, key: "answer.a2", entry: 0, source: "model", confidence: 0.6 }],
    };
    const kept = await resolveMappings(fields, fits, { answers });
    expect(kept.mappings.find((m) => m.ref === pronouns.ref)).toMatchObject({ key: "answer.a2", source: "model" });
  });
});
