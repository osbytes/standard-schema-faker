import type { BackendInstance, HeuristicRule, JSONSchema, MatchContext } from "../index.js";
import { ancestorKeys } from "../index.js";
import type { FakerBackendInstance } from "./index.js";

/**
 * `defaultHeuristics` — the ruleset `standard-schema-faker/faker` (this subpath) turns on by
 * default. The root `standard-schema-faker` entry ships ZERO rules; this file is the only
 * place opinions about "what does a `firstName` field look like" live, and it's a plain,
 * inspectable, filterable array — remove a rule with
 * `defaultHeuristics.filter(r => r.name !== 'person.name')`, or put your own rule ahead of it
 * to win (first match wins; see README's "Realistic fields (heuristics)" section for recipes).
 *
 * Every `generate()` here draws exclusively from `ctx.backend` — specifically the seeded
 * `Faker` instance exposed via `FakerBackendInstance.faker` (see index.ts) — never an
 * unseeded/global faker call, so heuristic output is deterministic per seed like everything
 * else in this library.
 *
 * Rules are ordered specific-before-generic within each category (and the whole array is
 * ordered so unambiguous, high-confidence matches like `email`/`uuid` come before broader
 * catch-alls like the plain `name` rule). `match` regexes are matched against the
 * *normalized* key (see core's `normalizeKey` — `first_name`/`firstName`/`FIRST-NAME` all
 * become `"firstname"`) and are deliberately ANCHORED (`^...$`), never bare substrings —
 * normalization strips all separators, so an unanchored `/name/` would spuriously match
 * `"username"`. This is a rule-authoring discipline the engine can't fully enforce; every
 * rule below is written to respect it, and it's exactly what the negative test cases in
 * heuristics.test.ts check for.
 *
 * SEMANTICALLY-EMPTY BARE KEYS — deliberately UNMATCHED, by design, not oversight: some bare
 * property names have no reliable single meaning without surrounding context, so no rule here
 * targets them at all (bare-key OR ancestor/sibling-aware) — they fall through to plain
 * generation rather than risk guessing wrong for a large fraction of real schemas:
 *
 *   - `value` — see the FHIR ContactPoint contextual rules below; a bare `value` with no
 *     recognizable ancestor/sibling context stays plain.
 *   - `title` — could mean a job title, a book/article/page title, or a generic UI label;
 *     `person.jobTitle` below only matches the unambiguous `jobTitle`/`jobPosition` variants,
 *     never bare `title` (a bare `title` would spuriously generate a job-title-shaped string
 *     for something like a book's `title` field).
 *
 * If your domain gives one of these a specific, reliable meaning, add your own rule ahead of
 * `defaultHeuristics` in your config (first match wins) rather than expecting this file to
 * guess it — see README's "Extend / remove / disable" recipes.
 */

function faker(backend: BackendInstance) {
  // `ctx.backend` is typed as core's plain `BackendInstance` in HeuristicRule.generate, but at
  // runtime (within this package) it's always the `FakerBackendInstance` `fakerBackend`
  // produces — this narrows that back so rules can call real faker.* methods. If a caller
  // somehow supplies `defaultHeuristics` alongside a non-faker backend (misconfiguration —
  // these rules only make sense paired with `fakerBackend`), throw a clear error rather than
  // silently calling `undefined.person` deep inside a rule.
  const instance = backend as Partial<FakerBackendInstance>;
  if (!instance.faker) {
    throw new Error(
      "standard-schema-faker: defaultHeuristics (from standard-schema-faker/faker) requires " +
        "fakerBackend to be the active backend — it calls real faker.* methods on the seeded " +
        "instance. Pass `backend: fakerBackend` alongside `heuristics: defaultHeuristics`.",
    );
  }
  return instance.faker;
}

/**
 * Reads `parentNode.properties[siblingKey].enum` out of a `JSONSchema` (a loosely-typed
 * `Record<string, unknown>`), returning `undefined` if any step of the shape isn't what's
 * expected. Small typed helper so the sibling-aware `contact.telecom.value` rule below doesn't
 * need repeated `as`-casts through `unknown` at each property access.
 */
function siblingEnum(parentNode: JSONSchema | undefined, siblingKey: string): unknown[] | undefined {
  const properties = parentNode?.properties;
  if (typeof properties !== "object" || properties === null) return undefined;
  const sibling = (properties as Record<string, unknown>)[siblingKey];
  if (typeof sibling !== "object" || sibling === null) return undefined;
  const enumValue = (sibling as Record<string, unknown>).enum;
  return Array.isArray(enumValue) ? enumValue : undefined;
}

/**
 * Is the nearest NAMED ancestor (array-index steps skipped — see `ancestorKeys`) one of FHIR's
 * conventional ContactPoint-array property names (`telecom`, `contactPoint(s)`, `contact(s)`)?
 *
 * REQUIRED gate for both ContactPoint rules below, not merely a bonus signal: `system` is a
 * heavily reused FHIR field name across UNRELATED types with a totally different shape --
 * `Coding.system` and `Identifier.system` are both URI strings (e.g.
 * `"http://hl7.org/fhir/sid/us-ssn"`), not a `phone`/`email`/... contact-kind enum. An object
 * merely HAVING a `system` property (even one whose value happens to look like a recognized
 * contact-kind string) is not reliable evidence it's a ContactPoint on its own -- the ancestor
 * field name is the actual discriminator FHIR gives us. The `system`-value content check
 * (`phone|email|fax|pager|url|sms|other`) in each rule below is the SECONDARY confirmation
 * layered on top of this gate, not a substitute for it.
 */
function nearestAncestorLooksLikeContactPointContainer(ctx: Pick<MatchContext, "ancestors">): boolean {
  const [nearest] = ancestorKeys(ctx);
  return nearest !== undefined && /^(telecom|contactpoints?|contacts?)$/.test(nearest);
}

export const defaultHeuristics: HeuristicRule[] = [
  // --- person ---
  {
    name: "person.firstName",
    match: /^(first|given)name$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).person.firstName(),
  },
  {
    name: "person.lastName",
    match: /^(last|family|sur)name$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).person.lastName(),
  },
  {
    name: "person.fullName",
    match: /^(full|display)name$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).person.fullName(),
  },
  {
    // Deliberately a default: a plain `name` field defaults to a person's full name.
    // Removable by design — filter this rule out (or put a more specific
    // rule for your domain ahead of it) if "name" means something else in your schema (e.g. a
    // product name — see `commerce.productName` below, which only fires on `productname`/
    // `itemname`, not bare `name`, so the two never collide).
    name: "person.name",
    match: /^name$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).person.fullName(),
  },
  {
    name: "person.gender",
    match: /^(gender|sex)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).person.sex(),
  },
  {
    // Deliberately narrow: matching bare `title` too would generate a job title ("Senior
    // Marketing Coordinator"-shaped text) for ANY field named `title` -- including a
    // book/article/page title, which "job title" is nothing like. Bare `title` is semantically
    // empty without context (same reasoning as the deliberately-absent bare `value` rule -- see
    // this file's header comment): it could mean a job title, a document title, a page title,
    // or a UI label. No rule matches it at all; only the unambiguous `jobTitle`/`jobPosition`
    // variants do.
    name: "person.jobTitle",
    match: /^(jobtitle|jobposition)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).person.jobTitle(),
  },
  {
    name: "person.bio",
    match: /^(bio|biography|about|aboutme)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).person.bio(),
  },

  // --- contact ---
  //
  // Contextual (path/sibling/ancestor-aware) rules come FIRST, before the bare-key rules below
  // — first match wins, and a contextual rule is by construction more specific than a bare-key
  // one. These exist for shapes where the leaf key alone is semantically empty: FHIR-style
  // `ContactPoint` objects
  // (https://build.fhir.org/datatypes.html#ContactPoint), e.g. `telecom: [{ system, use, value
  // }]`, or simpler discriminator-less array shapes like `phone: [{ value, type }]` — a
  // property literally named `value` tells you nothing on its own; the signal is in the
  // ancestor/sibling shape.
  //
  // Ordered by SIGNAL STRENGTH (strongest first — see README's rule table):
  //   1. glob rules (`**.phone.value`) — cheap, path-shape-only.
  //   2. sibling-VALUE-aware rules — read `ctx.siblings.system`, the ACTUAL generated value of
  //      a sibling property (not just its possible enum values), giving a real correlation.
  //      REQUIRES an ancestor-name gate too (see `nearestAncestorLooksLikeContactPointContainer`)
  //      since `system` alone is not reliable (FHIR reuses that field name for
  //      `Coding.system`/`Identifier.system`, unrelated URI-valued fields). Relies on the
  //      walker's two-tier property ordering (enum/const properties are generated before
  //      everything else, regardless of declaration order), so it works whether a schema
  //      declares the discriminator before or after the dependent field.
  //   3. ancestor-NAME-only rules — for shapes with no discriminator sibling at all (e.g.
  //      `phone: [{ value, type }]`, `emails: [{ value, label }]`): the only signal is the
  //      nearest NAMED ancestor (`ancestorKeys(ctx)`, array-index steps skipped). Strictly
  //      weaker than tier 2 — explicitly declines whenever a `system`-like discriminator
  //      sibling IS present, so a schema with both signals is resolved by the stronger tier 2
  //      rule, never guessed from the ancestor name alone.
  //   4. the container-node rule — generates the WHOLE object in one shot; still useful when
  //      you want to correlate properties that AREN'T ordering-hoisted (e.g. two independent
  //      non-enum fields), or want full control over every property at once. Same ancestor-name
  //      gate requirement as tier 2, for the same `system`-reuse reason.
  //   5. bare-key rules (below, in the other categories in this file) — the weakest tier,
  //      matching on the leaf key alone with no context at all.
  {
    name: "contact.phone.value (glob)",
    // Matches `phone.value` at any depth/nesting (semantic path — array indices already
    // stripped, so this fires on `phone.0.value`, `contacts.2.phone.value`, etc.).
    match: "**.phone.value",
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).phone.number(),
  },
  {
    name: "contact.phone.*.number (glob)",
    // `phone: [{ number: '...' }]` shape (as opposed to `{ value: '...' }` above).
    match: "**.phone.*.number",
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).phone.number(),
  },
  {
    name: "contact.email.value (glob)",
    match: "**.email.value",
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).internet.email(),
  },
  {
    name: "contact.telecom (container, fully correlated)",
    // FHIR `ContactPoint`: `{ system: 'phone' | 'email' | ..., value: '...', use: '...' }`.
    // A CONTAINER-node rule (when: {type: 'object'}) generates the whole object in one shot,
    // so `value` is actually correlated with the `system` it picks — the engine then checks
    // structural fit (required keys present, each property's basic type matches) and declines
    // if the schema doesn't look like a ContactPoint at all.
    //
    // TWO-PART match, both required: (1) the nearest named ancestor must look like a
    // ContactPoint-array property (`telecom`/`contact(s)`/`contactPoint(s)`) --
    // `nearestAncestorLooksLikeContactPointContainer` -- because `system` alone is NOT a
    // reliable signal (FHIR reuses that field name for `Coding.system`/`Identifier.system`,
    // both URI strings unrelated to contact kinds); (2) the node's own `system` enum, as
    // secondary confirmation once the ancestor gate has already passed.
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
            return faker(backend).internet.email();
          case "url":
            return faker(backend).internet.url();
          default:
            return faker(backend).phone.number(); // phone/fax/pager/sms/other
        }
      })();
      const propertyKeys = Object.keys((node.properties as Record<string, unknown> | undefined) ?? {});
      const result: Record<string, unknown> = { system, value };
      // `use` (home/work/mobile/...) is a real FHIR ContactPoint property but not load-bearing
      // for the system<->value correlation this rule exists to demonstrate — only set it if
      // the schema actually declares it, and pick from ITS OWN enum if present (never
      // hardcode a value foreign to the schema's declared options).
      if (propertyKeys.includes("use")) {
        const useEnum = siblingEnum(node, "use");
        if (useEnum && useEnum.length > 0) result.use = backend.pick(useEnum);
      }
      return result;
    },
  },
  {
    name: "contact.telecom.value (sibling-VALUE-aware, leaf)",
    // Reads `ctx.siblings.system` — the ACTUAL value already generated for the `system`
    // property (not merely its schema-declared possible enum values, which is all `ctx.parent`
    // could tell you) — so `value` is genuinely correlated with what `system` generated for
    // THIS instance, not just "some value consistent with one of its possibilities." Relies on
    // the walker's two-tier property ordering (enum/const properties, like `system`, are
    // generated before other properties regardless of declaration order — see walker.ts's
    // `generateObject`), so this fires correctly whether the schema declares `system` before
    // or after `value`.
    //
    // REQUIRES the ancestor gate (`nearestAncestorLooksLikeContactPointContainer`), same
    // reasoning as the container rule above: `system` is reused across unrelated FHIR types
    // (`Coding.system`/`Identifier.system` are URI strings, not contact-kind enums), so a
    // sibling literally named `system` is not sufficient evidence on its own. Declines cleanly
    // when the ancestor doesn't match, when `system` hasn't been generated yet (shouldn't
    // happen given the ordering guarantee, but costs nothing to check), or was generated but
    // isn't a recognizable contact-point kind.
    match: (ctx) => ctx.key === "value" && nearestAncestorLooksLikeContactPointContainer(ctx) && typeof ctx.siblings.system === "string",
    when: { type: "string" },
    generate: ({ backend, siblings }) => {
      const system = (siblings.system as string).toLowerCase();
      switch (system) {
        case "phone":
        case "fax":
        case "pager":
        case "sms":
          return faker(backend).phone.number();
        case "email":
          return faker(backend).internet.email();
        case "url":
          return faker(backend).internet.url();
        default:
          return undefined; // decline -> fall through (unrecognized `system` value)
      }
    },
  },
  {
    name: "contact.phone.value (ancestor-name, no discriminator)",
    // Ancestor-name-driven, for shapes with NO `system`-style discriminator sibling at all --
    // e.g. `phone: [{ value: '...', type: 'mobile' }]`, `emails: [{ value: '...', label: 'work' }]`.
    // The leaf key alone (`value`/`number`) is semantically empty; the only signal is the
    // NEAREST NAMED ancestor (`ancestorKeys(ctx)`, array-index steps skipped). Ordered AFTER the
    // sibling-VALUE-aware rule above (first match wins) so a `system`-discriminated ContactPoint
    // under `telecom` is always resolved by the stronger, generated-value-aware rule, never
    // guessed from the ancestor name alone -- this rule explicitly declines whenever
    // `ctx.siblings.system` is already a string, as a second line of defense on top of ordering.
    match: (ctx) =>
      (ctx.key === "value" || ctx.key === "number") &&
      typeof ctx.siblings.system !== "string" &&
      /^(phones?|mobiles?|faxes?)$/.test(ancestorKeys(ctx)[0] ?? ""),
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).phone.number(),
  },
  {
    name: "contact.email.value (ancestor-name, no discriminator)",
    // `emails: [{ value: '...' }]` / `emails: [{ address: '...' }]` -- no discriminator sibling.
    match: (ctx) =>
      (ctx.key === "value" || ctx.key === "address") &&
      typeof ctx.siblings.system !== "string" &&
      /^(emails?|emailaddresses?)$/.test(ancestorKeys(ctx)[0] ?? ""),
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).internet.email(),
  },
  {
    name: "contact.url.value (ancestor-name, no discriminator)",
    // `urls: [{ value: '...' }]` / `links: [{ value: '...' }]` -- no discriminator sibling.
    match: (ctx) =>
      ctx.key === "value" && typeof ctx.siblings.system !== "string" && /^(urls?|websites?|links?)$/.test(ancestorKeys(ctx)[0] ?? ""),
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).internet.url(),
  },
  {
    name: "contact.email",
    // `format: 'email'` is already handled natively by the format tier (higher fidelity,
    // guaranteed-valid) -- this rule only needs to fire for a format-less email-ish field
    // (the default `when` with no `formats` already restricts to format-less nodes).
    match: /^(email|emailaddress)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).internet.email(),
  },
  {
    name: "contact.phone",
    match: /^(phone|phonenumber|mobile|telephone|tel)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).phone.number(),
  },

  // --- internet ---
  {
    name: "internet.username",
    match: /^(username|userid|login|handle)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).internet.username(),
  },
  {
    name: "internet.password",
    match: /^password$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).internet.password(),
  },
  {
    name: "internet.url",
    match: /^(url|website|homepage|link)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).internet.url(),
  },
  {
    name: "internet.avatar",
    match: /^(avatar|avatarurl|image|imageurl|photo|photourl|picture|pictureurl)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).image.avatar(),
  },
  {
    name: "internet.ip",
    match: /^(ip|ipaddress)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).internet.ip(),
  },
  {
    name: "internet.userAgent",
    match: /^(useragent|ua)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).internet.userAgent(),
  },
  {
    name: "internet.domain",
    match: /^domain$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).internet.domainName(),
  },

  // --- address ---
  {
    name: "address.street",
    match: /^(street|streetaddress|address1|addressline1)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).location.streetAddress(),
  },
  {
    name: "address.street2",
    match: /^(address2|addressline2)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).location.secondaryAddress(),
  },
  {
    name: "address.city",
    match: /^(city|town)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).location.city(),
  },
  {
    name: "address.state",
    match: /^(state|province|region)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).location.state(),
  },
  {
    name: "address.zip",
    match: /^(zip|zipcode|postalcode|postcode)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).location.zipCode(),
  },
  {
    name: "address.country",
    match: /^country$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).location.country(),
  },
  {
    name: "address.countryCode",
    match: /^countrycode$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).location.countryCode(),
  },
  {
    name: "address.latitude",
    match: /^(lat|latitude)$/,
    when: { type: "number" },
    generate: ({ backend }) => faker(backend).location.latitude(),
  },
  {
    name: "address.longitude",
    match: /^(lng|lon|long|longitude)$/,
    when: { type: "number" },
    generate: ({ backend }) => faker(backend).location.longitude(),
  },
  {
    name: "address.timezone",
    match: /^(timezone|tz)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).location.timeZone(),
  },

  // --- company ---
  {
    name: "company.name",
    match: /^(companyname|company|organization|org|employer)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).company.name(),
  },
  {
    name: "company.department",
    match: /^department$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).commerce.department(),
  },
  {
    name: "company.industry",
    // No dedicated faker.industry-style call exists; commerce.department() doubles as a
    // reasonable business-sector proxy (retail-style categories read plausibly as industries).
    match: /^industry$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).commerce.department(),
  },

  // --- commerce ---
  {
    name: "commerce.productName",
    match: /^(productname|itemname)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).commerce.productName(),
  },
  {
    name: "commerce.price",
    match: /^(price|amount|cost)$/,
    when: { type: "number" },
    generate: ({ backend }) => Number(faker(backend).commerce.price()),
  },
  {
    name: "commerce.currency",
    match: /^currency$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).finance.currencyCode(),
  },
  {
    name: "commerce.sku",
    match: /^sku$/,
    when: { type: "string" },
    generate: ({ backend }) => {
      const f = faker(backend);
      return `${f.string.alpha({ length: 3, casing: "upper" })}-${f.number.int({ min: 1000, max: 99999 })}`;
    },
  },
  {
    // Generates NEUTRAL prose (faker.lorem.sentences(2)) for a field literally named
    // `description`, rather than a PRODUCT-shaped description (faker.commerce.
    // productDescription(), e.g. "The Fantastic Wooden Chair range...") — a person's bio field,
    // a task's description, a support ticket's description, etc. have no commerce-specific
    // signal at all, so guessing "commerce" for a generic field name would be wrong far more
    // often than right.
    name: "text.description",
    match: /^description$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).lorem.sentences(2),
  },

  // --- finance ---
  {
    name: "finance.iban",
    match: /^iban$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).finance.iban(),
  },
  {
    name: "finance.creditCard",
    match: /^(creditcard|creditcardnumber|cardnumber)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).finance.creditCardNumber(),
  },
  {
    name: "finance.accountNumber",
    match: /^(accountnumber|accountno)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).finance.accountNumber(),
  },
  {
    name: "finance.bic",
    match: /^(bic|swift|swiftcode)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).finance.bic(),
  },

  // --- ids/dates ---
  {
    name: "ids.uuid",
    // Only fires for a format-less field literally named `id`/`uuid` — an explicit
    // `format: 'uuid'` node is already handled by the (guaranteed-valid) format tier.
    match: /^(id|uuid|guid)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).string.uuid(),
  },
  {
    name: "ids.slug",
    match: /^slug$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).lorem.slug(),
  },
  {
    name: "dates.createdAt",
    match: /^createdat$/,
    when: { type: "string" },
    // `date.past()` with no `refDate` defaults to `Date.now()` (upstream faker-js/faker#1870),
    // which would make the same seed produce a different value depending on which day the
    // process ran. No explicit `refDate` needed here — `fakerBackend`
    // calls `faker.setDefaultRefDate(options?.referenceDate ?? REFERENCE_DATE)` once per
    // `.create()` (see index.ts), and `date.past()` inherits that default like every other
    // relative-date method, so this stays stable across processes/days (or follows a configured
    // `FakerConfig.referenceDate`) without passing `refDate` explicitly at every call site.
    generate: ({ backend }) => faker(backend).date.past().toISOString(),
  },
  {
    name: "dates.updatedAt",
    match: /^updatedat$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).date.recent().toISOString(),
  },
  {
    name: "dates.deletedAt",
    match: /^deletedat$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).date.recent().toISOString(),
  },
  {
    name: "dates.birthDate",
    match: /^(birthdate|dob|dateofbirth)$/,
    when: { type: "string" },
    // faker's `date.birthdate()` defaults to `mode: 'age', min: 18, max: 80` when no explicit
    // range is given — silently excluding both children and centenarians from any schema using
    // this rule (a person schema meant to cover a general population, e.g. a patient registry,
    // would never generate a birth date implying age 0-17 or 81-100). Pinned to an explicit,
    // wider {min: 0, max: 100} age window — see README's rule table for the documented "born up
    // to 100y before REFERENCE_DATE (or a configured `referenceDate`), never after it" contract,
    // and the swap recipe there for narrowing back down to a specific age range (e.g.
    // adults-only). No explicit `refDate` needed — `date.birthdate({mode: 'age', ...})`
    // inherits `faker.setDefaultRefDate` exactly like faker's other relative-date methods (see
    // `REFERENCE_DATE`'s doc comment in index.ts).
    generate: ({ backend }) => faker(backend).date.birthdate({ mode: "age", min: 0, max: 100 }).toISOString().slice(0, 10),
  },

  // --- media ---
  {
    name: "media.color",
    match: /^(color|colour|hexcolor)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).color.rgb({ format: "hex" }),
  },
  {
    name: "media.mimeType",
    match: /^(mimetype|contenttype)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).system.mimeType(),
  },
  {
    name: "media.fileName",
    match: /^(filename|file)$/,
    when: { type: "string" },
    generate: ({ backend }) => faker(backend).system.fileName(),
  },
];
