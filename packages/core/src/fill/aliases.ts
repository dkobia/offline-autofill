// Value aliases for option matching: a profile says "California" and the
// form's dropdown wants "CA", or the other way around. Small, static, and
// only consulted when no option matches the value directly.

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

const COUNTRIES: string[][] = [
  ["US", "USA", "United States", "United States of America", "U.S.", "U.S.A."],
  ["GB", "UK", "United Kingdom", "Great Britain", "Britain", "England"],
  ["KE", "Kenya"],
  ["CA", "Canada"],
  ["AU", "Australia"],
  ["DE", "Germany", "Deutschland"],
  ["FR", "France"],
  ["IN", "India"],
  ["NG", "Nigeria"],
  ["ZA", "South Africa"],
  ["NL", "Netherlands", "The Netherlands", "Holland"],
  ["IE", "Ireland"],
  ["NZ", "New Zealand"],
];

const ALIASES = new Map<string, Set<string>>();

function register(group: string[]): void {
  const set = new Set(group.map((value) => value.toLowerCase()));
  for (const value of set) {
    const existing = ALIASES.get(value);
    if (existing) {
      for (const other of set) existing.add(other);
    } else {
      ALIASES.set(value, new Set(set));
    }
  }
}

for (const [code, name] of Object.entries(US_STATES)) {
  register([code, name]);
}
for (const group of COUNTRIES) {
  register(group);
}

/** Every spelling considered equivalent to the value, lowercased, including itself. */
export function aliasesOf(value: string): Set<string> {
  const lower = value.trim().toLowerCase();
  return ALIASES.get(lower) ?? new Set([lower]);
}
