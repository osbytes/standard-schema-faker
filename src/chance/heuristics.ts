import type { BackendInstance, HeuristicRule, JSONSchema, MatchContext } from "../index.js";
import { ancestorKeys } from "../index.js";
import type { ChanceBackendInstance } from "./index.js";

/**
 * `chanceHeuristics` — the ruleset `standard-schema-faker/chance` (this subpath) turns on by
 * default, mirroring `standard-schema-faker/faker`'s `defaultHeuristics` structure/gates/
 * priority ordering exactly (same rule names/categories where chance has an equivalent
 * generator, same FHIR ContactPoint tiering, same normalization/anchoring discipline) — only the
 * underlying generator calls differ (`chance.*` instead of `faker.*`).
 *
 * **Coverage vs `defaultHeuristics` (faker)** — chance has no dedicated generator for some
 * fields faker covers; rather than fake those badly (a hand-rolled, unconvincing stand-in), this
 * ruleset simply OMITS the rule, falling through to plain generation for that field. Omitted,
 * with the faker-side rule name for cross-reference:
 *
 *   - `person.jobTitle` — INCLUDED, but via `chance.profession()` (no chance equivalent of
 *     faker's seniority-word-structured job titles; `profession()` is the closest real analog).
 *   - `commerce.productName` / `commerce.price` / `commerce.sku` — chance has no product-catalog
 *     generator at all (no `commerce.*` namespace); `finance.currency` is kept (chance does have
 *     `currency()`), but SKU/product name/price are omitted entirely.
 *   - `finance.iban` / `finance.bic` / `finance.accountNumber` — chance has no dedicated
 *     IBAN/BIC/bank-account-number generator in its typed, documented surface (a runtime-only
 *     `iban()` exists but isn't part of chance's typed/documented API — not relied on here).
 *   - `company.department` / `company.industry` — no chance equivalent of faker's
 *     `commerce.department()`; omitted rather than mis-labeling something else as an industry.
 *   - `internet.userAgent` / `internet.domain` (bare `domain` key) — `internet.domain` (the URL
 *     rule) is instead covered by `hostname`-shaped `chance.domain()` (see `internet.hostname`
 *     below); `userAgent` has no chance equivalent.
 *   - `media.mimeType` / `media.fileName` — no chance equivalent.
 *   - `ids.slug` — no dedicated slug generator (faker's `lorem.slug()`); omitted.
 *
 * Everything else below maps onto a real `chance.*` call. Every `generate()` here draws
 * exclusively from `ctx.backend` — specifically the seeded `Chance` instance exposed via
 * `ChanceBackendInstance.chance` (see index.ts) — never a fresh/unseeded `Chance`, so heuristic
 * output is deterministic per seed like everything else in this library.
 */

function chanceOf(backend: BackendInstance): Chance.Chance {
  // `ctx.backend` is typed as core's plain `BackendInstance` in HeuristicRule.generate, but at
  // runtime (within this package) it's always the `ChanceBackendInstance` `chanceBackend`
  // produces — this narrows that back so rules can call real chance.* methods. Mirrors the
  // faker adapter's own `faker(backend)` helper. If a caller somehow supplies `chanceHeuristics`
  // alongside a non-chance backend (misconfiguration — these rules only make sense paired with
  // `chanceBackend`), throw a clear error rather than silently calling `undefined.first()` deep
  // inside a rule.
  const instance = backend as Partial<ChanceBackendInstance>;
  if (!instance.chance) {
    throw new Error(
      "standard-schema-faker: chanceHeuristics (from standard-schema-faker/chance) requires " +
        "chanceBackend to be the active backend — it calls real chance.* methods on the seeded " +
        "instance. Pass `backend: chanceBackend` alongside `heuristics: chanceHeuristics`.",
    );
  }
  return instance.chance;
}

/** Same helper as the faker adapter's heuristics.ts — reads `parentNode.properties[siblingKey].enum` out of a `JSONSchema`, returning `undefined` if any step of the shape isn't what's expected. */
function siblingEnum(parentNode: JSONSchema | undefined, siblingKey: string): unknown[] | undefined {
  const properties = parentNode?.properties;
  if (typeof properties !== "object" || properties === null) return undefined;
  const sibling = (properties as Record<string, unknown>)[siblingKey];
  if (typeof sibling !== "object" || sibling === null) return undefined;
  const enumValue = (sibling as Record<string, unknown>).enum;
  return Array.isArray(enumValue) ? enumValue : undefined;
}

/** Same ancestor-name gate as the faker adapter's `nearestAncestorLooksLikeContactPointContainer` — see that function's doc comment (heuristics.ts, faker adapter) for the full "why `system` alone isn't reliable" rationale; identical logic here, just consumed by this ruleset's own rules. */
function nearestAncestorLooksLikeContactPointContainer(ctx: Pick<MatchContext, "ancestors">): boolean {
  const [nearest] = ancestorKeys(ctx);
  return nearest !== undefined && /^(telecom|contactpoints?|contacts?)$/.test(nearest);
}

export const chanceHeuristics: HeuristicRule[] = [
  // --- person ---
  {
    name: "person.firstName",
    match: /^(first|given)name$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).first(),
  },
  {
    name: "person.lastName",
    match: /^(last|family|sur)name$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).last(),
  },
  {
    name: "person.fullName",
    match: /^(full|display)name$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).name(),
  },
  {
    // Deliberately a default, same as the faker adapter's "person.name" — removable by design,
    // see chance/index.ts's coverage note and the faker adapter's own rule for the rationale.
    name: "person.name",
    match: /^name$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).name(),
  },
  {
    name: "person.gender",
    match: /^(gender|sex)$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).gender(),
  },
  {
    // Same deliberate narrowness as the faker adapter — never matches bare `title` (semantically
    // empty without context; see this file's header comment and the faker adapter's own rule).
    name: "person.jobTitle",
    match: /^(jobtitle|jobposition)$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).profession(),
  },
  {
    name: "person.bio",
    // chance has no dedicated `bio()` helper (faker does) — a short sentence is the closest
    // realistic analog, same "neutral prose" approach as `text.description` below.
    match: /^(bio|biography|about|aboutme)$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).sentence({ words: 14 }),
  },

  // --- contact ---
  // Same signal-strength ordering and rationale as the faker adapter's contact rules (glob ->
  // sibling-VALUE-aware -> ancestor-name-only -> container -> bare-key) — see that file's header
  // comment for the full FHIR ContactPoint discussion; not re-derived here.
  {
    name: "contact.phone.value (glob)",
    match: "**.phone.value",
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).phone(),
  },
  {
    name: "contact.phone.*.number (glob)",
    match: "**.phone.*.number",
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).phone(),
  },
  {
    name: "contact.email.value (glob)",
    match: "**.email.value",
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).email(),
  },
  {
    name: "contact.telecom (container, fully correlated)",
    match: (ctx) => nearestAncestorLooksLikeContactPointContainer(ctx) && Array.isArray(siblingEnum(ctx.node, "system")),
    when: { type: "object" },
    generate: ({ backend, node }) => {
      const systemEnum = siblingEnum(node, "system") ?? [];
      const recognized = systemEnum.filter((s): s is string => typeof s === "string" && /^(phone|email|fax|pager|url|sms|other)$/i.test(s));
      if (recognized.length === 0) return undefined; // decline -> not a recognizable ContactPoint
      const system = backend.pick(recognized);
      const value = (() => {
        switch (system.toLowerCase()) {
          case "email":
            return chanceOf(backend).email();
          case "url":
            return chanceOf(backend).url();
          default:
            return chanceOf(backend).phone(); // phone/fax/pager/sms/other
        }
      })();
      const propertyKeys = Object.keys((node.properties as Record<string, unknown> | undefined) ?? {});
      const result: Record<string, unknown> = { system, value };
      if (propertyKeys.includes("use")) {
        const useEnum = siblingEnum(node, "use");
        if (useEnum && useEnum.length > 0) result.use = backend.pick(useEnum);
      }
      return result;
    },
  },
  {
    name: "contact.telecom.value (sibling-VALUE-aware, leaf)",
    match: (ctx) => ctx.key === "value" && nearestAncestorLooksLikeContactPointContainer(ctx) && typeof ctx.siblings.system === "string",
    when: { type: "string" },
    generate: ({ backend, siblings }) => {
      const system = (siblings.system as string).toLowerCase();
      switch (system) {
        case "phone":
        case "fax":
        case "pager":
        case "sms":
          return chanceOf(backend).phone();
        case "email":
          return chanceOf(backend).email();
        case "url":
          return chanceOf(backend).url();
        default:
          return undefined; // decline -> fall through (unrecognized `system` value)
      }
    },
  },
  {
    name: "contact.phone.value (ancestor-name, no discriminator)",
    match: (ctx) =>
      (ctx.key === "value" || ctx.key === "number") &&
      typeof ctx.siblings.system !== "string" &&
      /^(phones?|mobiles?|faxes?)$/.test(ancestorKeys(ctx)[0] ?? ""),
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).phone(),
  },
  {
    name: "contact.email.value (ancestor-name, no discriminator)",
    match: (ctx) =>
      (ctx.key === "value" || ctx.key === "address") &&
      typeof ctx.siblings.system !== "string" &&
      /^(emails?|emailaddresses?)$/.test(ancestorKeys(ctx)[0] ?? ""),
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).email(),
  },
  {
    name: "contact.url.value (ancestor-name, no discriminator)",
    match: (ctx) =>
      ctx.key === "value" && typeof ctx.siblings.system !== "string" && /^(urls?|websites?|links?)$/.test(ancestorKeys(ctx)[0] ?? ""),
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).url(),
  },
  {
    name: "contact.email",
    match: /^(email|emailaddress)$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).email(),
  },
  {
    name: "contact.phone",
    match: /^(phone|phonenumber|mobile|telephone|tel)$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).phone(),
  },

  // --- internet ---
  {
    name: "internet.username",
    // chance has no dedicated `username()` helper -- `twitter()` (an "@handle"-shaped string,
    // stripped of its leading "@") is the closest realistic analog.
    match: /^(username|userid|login|handle)$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).twitter().replace(/^@/, ""),
  },
  {
    name: "internet.password",
    // chance has no dedicated `password()` helper -- a fixed-length hex hash is a reasonable
    // password-shaped stand-in (opaque, fixed-length, non-guessable-looking).
    match: /^password$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).hash({ length: 16 }),
  },
  {
    name: "internet.url",
    match: /^(url|website|homepage|link)$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).url(),
  },
  {
    name: "internet.avatar",
    // `protocol: 'https'` forces a full absolute URL -- chance's bare `avatar()` default is
    // protocol-RELATIVE ("//www.gravatar.com/..."), which is not a valid standalone URL (fails
    // `new URL(...)`/a `format: uri` check) without an inherited base.
    match: /^(avatar|avatarurl|image|imageurl|photo|photourl|picture|pictureurl)$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).avatar({ protocol: "https" }),
  },
  {
    name: "internet.ip",
    match: /^(ip|ipaddress)$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).ip(),
  },
  {
    name: "internet.hostname",
    match: /^domain$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).domain(),
  },

  // --- address ---
  {
    name: "address.street",
    match: /^(street|streetaddress|address1|addressline1)$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).address(),
  },
  {
    name: "address.city",
    match: /^(city|town)$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).city(),
  },
  {
    name: "address.state",
    match: /^(state|province|region)$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).state(),
  },
  {
    name: "address.zip",
    match: /^(zip|zipcode|postalcode|postcode)$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).zip(),
  },
  {
    name: "address.country",
    match: /^country$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).country({ full: true }),
  },
  {
    name: "address.countryCode",
    match: /^countrycode$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).country(),
  },
  {
    name: "address.latitude",
    match: /^(lat|latitude)$/,
    when: { type: "number" },
    generate: ({ backend }) => chanceOf(backend).latitude(),
  },
  {
    name: "address.longitude",
    match: /^(lng|lon|long|longitude)$/,
    when: { type: "number" },
    generate: ({ backend }) => chanceOf(backend).longitude(),
  },

  // --- company ---
  {
    name: "company.name",
    match: /^(companyname|company|organization|org|employer)$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).company(),
  },

  // --- text ---
  {
    // Neutral prose, same rationale as the faker adapter's "text.description" (renamed away
    // from a commerce-flavored generator) -- see that file's header comment.
    name: "text.description",
    match: /^description$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).paragraph({ sentences: 2 }),
  },

  // --- finance ---
  {
    name: "finance.creditCard",
    match: /^(creditcard|creditcardnumber|cardnumber)$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).cc(),
  },
  {
    name: "finance.currency",
    match: /^currency$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).currency().code,
  },

  // --- ids/dates ---
  {
    name: "ids.uuid",
    match: /^(id|uuid|guid)$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).guid({ version: 4 }),
  },
  {
    name: "dates.createdAt",
    match: /^createdat$/,
    when: { type: "string" },
    // No `refDate`/`setDefaultRefDate`-style argument needed here -- unlike the faker adapter,
    // this reaches straight for `BackendInstance.date()` (bounds already anchored to this call's
    // configured `referenceDate` inside `chanceBackend.create()`, see index.ts), rather than a
    // chance method of its own that would silently default to `Date.now()`.
    generate: ({ backend }) => backend.date().toISOString(),
  },
  {
    name: "dates.updatedAt",
    match: /^updatedat$/,
    when: { type: "string" },
    generate: ({ backend }) => backend.date().toISOString(),
  },
  {
    name: "dates.deletedAt",
    match: /^deletedat$/,
    when: { type: "string" },
    generate: ({ backend }) => backend.date().toISOString(),
  },
  {
    name: "dates.birthDate",
    match: /^(birthdate|dob|dateofbirth)$/,
    when: { type: "string" },
    // chance's own `birthday()` derives its window from `Date.now()` internally (verified
    // against chance's source -- no reference-date override knob exists, unlike faker's
    // `setDefaultRefDate`), which would silently break "same seed -> identical output" across
    // days/machines -- see index.ts's `REFERENCE_DATE` doc comment. Deliberately NOT used here;
    // instead, mirrors the faker adapter's explicit {min: 0, max: 100}-year age window: born up
    // to 100 years before this call's referenceDate, never after it. `ChanceBackendInstance.
    // referenceDate` (see index.ts) exposes the exact anchor `.create()` resolved
    // (`options?.referenceDate ?? REFERENCE_DATE`), so this window tracks a configured
    // `FakerConfig.referenceDate` the same way the faker adapter's rule does via
    // `setDefaultRefDate`, without depending on chance's own "now" handling at all.
    generate: ({ backend }) => {
      chanceOf(backend); // guards against a non-chance backend, same as every other rule here
      const { referenceDate } = backend as ChanceBackendInstance;
      const hundredYearsBefore = new Date(referenceDate.getTime());
      hundredYearsBefore.setFullYear(hundredYearsBefore.getFullYear() - 100);
      return backend.date(hundredYearsBefore, referenceDate).toISOString().slice(0, 10);
    },
  },

  // --- media ---
  {
    name: "media.color",
    match: /^(color|colour|hexcolor)$/,
    when: { type: "string" },
    generate: ({ backend }) => chanceOf(backend).color({ format: "hex" }),
  },
];
