/**
 * deterministicMatcher.js
 *
 * Rule-based matching module for EEO (Equal Employment Opportunity) and other
 * demographic/compliance dropdown fields found on job application forms.
 *
 * This module performs all matching WITHOUT making any AI/LLM API calls.
 * It uses pattern matching, synonym tables, and simple heuristics to map
 * a user's saved answers to the closest available dropdown option. This
 * approach is both faster and cheaper than routing these well-understood
 * question types through the AI pipeline.
 *
 * Imported by background.js. The main export is `deterministicFieldMatcher`.
 */

// ─── Question topic detection ─────────────────────────────────────────────────
//
// TOPIC_PATTERNS maps each known question topic to an array of regexes.
// When a form question label is scanned, these patterns are tested in order
// until a match is found. The first matching topic is returned.
//
// Topics are intentionally ordered from most-specific (gender_identity,
// sexual_orientation) to least-specific (gender) so that a question containing
// "gender identity" doesn't accidentally match the broader "gender" bucket.

const TOPIC_PATTERNS = {
  // More specific gender identity questions (cis/trans identity) — must come BEFORE
  // generic "gender" to prevent /\bgender\b/ from matching "gender identity" first.
  gender_identity: [
    /\bgender.?identity\b/i, /\bcisgender\b/i, /\btransgender\b/i,
    /\bi identify as\b/i
  ],

  // Standard male/female gender question — very common on job applications
  gender: [
    /\bgender\b/i, /\bsex\b/i, /\bman\b.*\bwoman\b/i,
    /\bi identify my gender\b/i, /\bmale\b.*\bfemale\b/i
  ],

  // Sexual orientation EEO questions
  sexual_orientation: [
    /\bsexual.?orientation\b/i, /\bstraight\b/i, /\bheterosexual\b/i,
    /\bi identify my sexual\b/i
  ],

  // Race and/or ethnicity EEO questions
  race_ethnicity: [
    /\brace\b/i, /\bethnicit/i, /\bethnic\b/i,
    /\bi identify my race\b/i
  ],

  // Hispanic/Latino heritage questions (often asked separately from general race)
  hispanic_latino: [
    /\bhispanic\b/i, /\blatino\b/i, /\blatina\b/i, /\blatinx\b/i
  ],

  // Military veteran status — triggers VEVRAA compliance questions
  veteran: [
    /\bveteran\b/i, /\bmilitary\b/i, /\bserved\b/i
  ],

  // Disability status — triggers Section 503 / ADA compliance questions
  disability: [
    /\bdisabilit/i, /\bhandicap\b/i, /\bi have a disability\b/i
  ],

  // Preferred pronouns field (increasingly common on modern ATS platforms)
  pronouns: [
    /\bpronoun/i
  ],

  // Work authorization — "Are you legally authorized to work in the US?"
  work_auth: [
    /\bauthori[zs]/i, /\bwork.*(?:us|united states|u\.s)/i,
    /\blegal.*work\b/i, /\beligib.*work\b/i, /\bemploy.*eligib/i
  ],

  // Visa sponsorship — "Will you now or in the future require sponsorship?"
  sponsorship: [
    /\bsponsor/i, /\bvisa\b/i, /\bh[-\s]?1b\b/i
  ],

  // ── New topics for expanded deterministic matching ─────────────────────────

  // Direct profile field lookups — no AI needed
  first_name: [/\bfirst.?name\b/i, /\bgiven.?name\b/i],
  last_name: [/\blast.?name\b/i, /\bsurname\b/i, /\bfamily.?name\b/i],
  full_name: [/\bfull.?name\b/i, /\byour.?name\b/i, /\bcandidate.?name\b/i, /\blegal.?name\b/i],
  email: [/\bemail\b/i, /\be-?mail\b/i],
  phone: [/\bphone\b/i, /\bmobile\b/i, /\bcell\b/i, /\btelephone\b/i, /\bcontact.?number\b/i],
  linkedin_url: [/\blinkedin\b/i],
  website_url: [/\bportfolio\b/i, /\bwebsite\b/i, /\bpersonal.?site\b/i],
  github_url: [/\bgithub\b/i],
  location: [/\bcity\b/i, /\blocation\b/i, /\baddress\b/i, /\bwhere.*based\b/i, /\bwhere.*located\b/i],
  current_title: [/\bcurrent.?title\b/i, /\bjob.?title\b/i, /\bcurrent.?role\b/i, /\bcurrent.?position\b/i],
  current_employer: [/\bcurrent.?employer\b/i, /\bcurrent.?company\b/i],

  // Date/availability fields
  start_date: [/\bstart.?date\b/i, /\bavailab/i, /\bwhen.*start\b/i, /\bearliest.*date\b/i, /\bbegin.?date\b/i],

  // Salary fields
  salary: [/\bsalary\b/i, /\bcompensation\b/i, /\bdesired.?pay\b/i, /\bexpected.?pay\b/i, /\bpay.?rate\b/i, /\bhourly.?rate\b/i],

  // Simple yes/no fields with clear context
  background_check: [/\bbackground.?check\b/i, /\bcriminal.?record\b/i],
  drug_test: [/\bdrug.?test\b/i, /\bdrug.?screen\b/i],
  drivers_license: [/\bdriver.?s?.?licen[sc]e\b/i, /\bdriving.?licen[sc]e\b/i],
  age_18: [/\b(?:at least |over )?18\b/i, /\blegal.*age\b/i, /\bof.?age\b/i],
  relocation: [/\brelocat/i, /\bwilling.*move\b/i],
  travel: [/\btravel\b/i, /\bwilling.*travel\b/i],

  // Education level
  education_level: [/\bhighest.*(?:education|degree|level)\b/i, /\beducation.*level\b/i, /\bdegree.*completed\b/i],

  // How did you hear about us
  referral_source: [/\bhow.*hear\b/i, /\bhow.*find\b/i, /\breferr/i, /\bsource\b/i]
};

// ─── Topic → Q&A keyword lookup table ────────────────────────────────────────
//
// When a topic is detected, TOPIC_TO_QA_KEYWORDS tells us which keywords to
// search for inside the user's saved Q&A entries (stored in their profile).
// Each topic maps to one or more keywords that would appear in a Q&A question.
//
// For example, if the topic is "work_auth" we look for Q&A entries whose
// question text includes phrases like "authorized to work" or "legally authorized".

const TOPIC_TO_QA_KEYWORDS = {
  gender:             ['gender'],
  gender_identity:    ['gender identity'],
  sexual_orientation: ['sexual orientation'],
  race_ethnicity:     ['race', 'ethnicity'],
  hispanic_latino:    ['hispanic', 'latino'],
  veteran:            ['veteran'],
  disability:         ['disability'],
  pronouns:           ['pronoun'],
  work_auth:          ['authorized to work', 'work authorization', 'legally authorized', 'eligible to work'],
  sponsorship:        ['sponsorship', 'visa', 'sponsor'],
  // New expanded topics
  first_name:         ['first name'],
  last_name:          ['last name'],
  full_name:          ['full name'],
  email:              ['email'],
  phone:              ['phone'],
  linkedin_url:       ['linkedin'],
  website_url:        ['portfolio', 'website'],
  github_url:         ['github'],
  location:           ['city', 'location', 'address'],
  current_title:      ['current job title', 'current title'],
  current_employer:   ['current employer', 'current company'],
  start_date:         ['start date', 'available', 'earliest'],
  salary:             ['salary', 'desired salary', 'hourly rate'],
  background_check:   ['background check'],
  drug_test:          ['drug test'],
  drivers_license:    ['driver'],
  age_18:             ['18 years', 'of age'],
  relocation:         ['relocate'],
  travel:             ['travel'],
  education_level:    ['education', 'highest', 'degree'],
  referral_source:    ['how did you hear', 'how heard']
};

// ─── Synonym maps for deterministic option matching ───────────────────────────
//
// ANSWER_SYNONYMS maps a user's saved answer (lowercase key) to an array of
// synonymous strings. During matching, these synonyms are tested against the
// text of each available dropdown option using a substring check.
//
// This is necessary because the same concept appears under many different
// labels across ATS platforms. For example:
//   - User saved "male"  →  option might say "Man" or "Male"
//   - User saved "indian" → option might say "South Asian (inclusive of ... India ...)"
//
// The synonym arrays are intentionally broad so that partial matches still work.

const ANSWER_SYNONYMS = {
  // ── Gender ──
  // Both "male"/"man" and "female"/"woman" map to the same synonym set so
  // either form of the user's answer can match either form of the option text.
  'male':   ['man', 'male', 'masculine', 'm'],
  'man':    ['man', 'male', 'masculine', 'm'],
  'female': ['woman', 'female', 'feminine', 'f'],
  'woman':  ['woman', 'female', 'feminine', 'f'],

  // ── Gender identity ──
  'cisgender':  ['cisgender', 'cis'],
  'transgender': ['transgender', 'trans'],

  // ── Sexual orientation ──
  // All three spellings of the same concept point to the same synonym list
  // so any combination of user answer vs option label will match.
  'heterosexual':         ['heterosexual', 'straight', 'straight/heterosexual'],
  'straight':             ['heterosexual', 'straight', 'straight/heterosexual'],
  'straight/heterosexual': ['heterosexual', 'straight', 'straight/heterosexual'],
  'gay':      ['gay'],
  'lesbian':  ['lesbian'],
  'bisexual': ['bisexual', 'bi'],

  // ── Yes / No ──
  // Used as a fallback for any yes/no field before the more specific
  // veteran/disability/work_auth handling in matchAnswerToOption().
  'yes': ['yes', 'true', '1'],
  'no':  ['no', 'false', '0'],

  // ── Race / Ethnicity ──
  // Users typically save a short common term ("indian", "black") but ATS
  // platforms present long, formal option labels. These synonyms bridge that
  // gap by mapping the short term to the keywords expected inside the long label.
  'south asian':    ['south asian'],
  'indian':         ['south asian', 'india'],       // "Indian" → "South Asian (incl. India)"
  'east asian':     ['east asian'],
  'chinese':        ['east asian', 'chinese'],
  'japanese':       ['east asian', 'japanese'],
  'korean':         ['east asian', 'korean'],
  'southeast asian': ['southeast asian'],
  'filipino':       ['southeast asian', 'filipino', 'philippine'],
  'vietnamese':     ['southeast asian', 'vietnamese'],
  'black':          ['black', 'african american'],
  'african american': ['black', 'african american'],
  'white':          ['white', 'caucasian', 'european'],
  'caucasian':      ['white', 'caucasian'],
  'hispanic':       ['hispanic', 'latino', 'latina', 'latinx'],
  'latino':         ['hispanic', 'latino'],
  'native american': ['american indian', 'alaska native', 'native american', 'indigenous'],
  'pacific islander': ['pacific islander', 'native hawaiian'],
  'middle eastern': ['middle eastern', 'north african'],  // MENA grouping used by some ATS
  'arab':           ['middle eastern', 'north african'],
  'central asian':  ['central asian'],
  'asian':          ['asian'],
  'two or more':    ['two or more', 'multiracial', 'mixed'],
};

// ─── Core: detect the topic of a form question ───────────────────────────────

/**
 * Scans a form question label and returns the most specific matching topic key,
 * or null if no known topic pattern matches.
 *
 * Matching is done by testing each regex in TOPIC_PATTERNS in insertion order.
 * The first pattern that matches wins, so more-specific topics must be listed
 * before broader ones in TOPIC_PATTERNS (e.g., gender_identity before gender).
 *
 * @param {string} questionText - The raw text of the form question label.
 * @returns {string|null} A topic key (e.g. "work_auth", "race_ethnicity") or null.
 */
function detectTopic(questionText) {
  const text = questionText.toLowerCase();

  // Iterate over every topic and its associated regex list
  for (const [topic, patterns] of Object.entries(TOPIC_PATTERNS)) {
    for (const pattern of patterns) {
      // Return on the very first match — no need to keep scanning
      if (pattern.test(text)) return topic;
    }
  }

  // No topic matched — this question should be handled by the AI pipeline
  return null;
}

// ─── Core: find a saved answer via the Q&A list ──────────────────────────────

/**
 * Searches the user's saved Q&A entries for one that matches the given topic,
 * and returns the saved answer string if found.
 *
 * The lookup works by checking whether the saved question text contains any of
 * the keywords associated with the topic in TOPIC_TO_QA_KEYWORDS.
 *
 * @param {string} topic - A topic key returned by detectTopic().
 * @param {Array<{question: string, answer: string}>} qaList - The user's Q&A entries.
 * @returns {string|null} The trimmed saved answer, or null if none found.
 */
function findQAAnswer(topic, qaList) {
  // Guard: nothing to search if the list is absent or empty
  if (!qaList || !qaList.length) return null;

  // Look up which keywords identify this topic in a Q&A question string
  const keywords = TOPIC_TO_QA_KEYWORDS[topic];
  if (!keywords) return null;

  for (const qa of qaList) {
    // Skip entries that have no answer saved yet
    if (!qa.answer || !qa.answer.trim()) continue;

    const qLower = qa.question.toLowerCase();

    // Check every keyword for this topic against the saved question text
    for (const kw of keywords) {
      if (qLower.includes(kw)) return qa.answer.trim();
    }
  }

  // No matching Q&A entry found for this topic
  return null;
}

// ─── Core: find a saved answer from the structured profile object ─────────────

/**
 * Checks the user's structured resume profile for a field that directly
 * corresponds to the given topic.
 *
 * Currently only "work_auth" is handled here because it is the only topic
 * that maps to a dedicated top-level field on the profile object. Other
 * topics (gender, race, etc.) are expected to live in the Q&A list instead.
 *
 * @param {string} topic - A topic key returned by detectTopic().
 * @param {Object|null} profile - The user's resume profile object.
 * @returns {string|null} The profile field value, or null if not applicable.
 */
function findProfileAnswer(topic, profile) {
  // Guard: profile may not be loaded yet
  if (!profile) return null;

  // Direct profile field lookups — zero AI tokens
  switch (topic) {
    case 'work_auth':
      return profile.workAuthorization || null;
    case 'first_name':
      return profile.name ? profile.name.split(' ')[0] : null;
    case 'last_name':
      return profile.name ? profile.name.split(' ').slice(1).join(' ') : null;
    case 'full_name':
      return profile.name || null;
    case 'email':
      return profile.email || null;
    case 'phone':
      return profile.phone || null;
    case 'linkedin_url':
      return profile.linkedin || null;
    case 'website_url':
      return profile.website || null;
    case 'github_url':
      return profile.github || null;
    case 'location':
      return profile.location || null;
    case 'current_title':
      // Return the most recent job title from experience
      if (Array.isArray(profile.experience) && profile.experience.length > 0) {
        return profile.experience[0].title || null;
      }
      return null;
    case 'current_employer':
      if (Array.isArray(profile.experience) && profile.experience.length > 0) {
        return profile.experience[0].company || null;
      }
      return null;
    default:
      return null;
  }
}

// ─── String normalization helper ──────────────────────────────────────────────

/**
 * Normalizes a string for case- and punctuation-insensitive comparison.
 * Lowercases the input, strips all non-alphanumeric characters (except spaces),
 * and collapses runs of whitespace to a single space.
 *
 * @param {string} str - The raw string to normalize.
 * @returns {string} The normalized string.
 *
 * @example
 *   normalize("South Asian (India)") // → "south asian india"
 *   normalize("Straight/Heterosexual") // → "straightheterosexual"  ← slash removed
 */
function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

// ─── Core: match a saved answer to the best available option ─────────────────

/**
 * Attempts to find the best match for a user's saved answer within an array
 * of available dropdown/radio options. Uses a cascading series of matching
 * strategies from strictest to most lenient.
 *
 * Matching strategies (applied in order, returning on the first hit):
 *   1. Exact case-insensitive match
 *   2. Normalized exact match (punctuation/whitespace stripped)
 *   3. Synonym-based substring match (uses ANSWER_SYNONYMS)
 *   4. Containment match (answer in option, or option in answer)
 *   5. Race/ethnicity word-level match (topic-specific; handles long option labels)
 *   6. Yes/No heuristic (topic-specific; handles natural-language yes/no answers)
 *
 * @param {string} savedAnswer - The answer the user has saved for this question type.
 * @param {string[]} options - All available option labels for the current form field.
 * @param {string} topic - The detected topic key (used for topic-specific logic).
 * @returns {string|null} The matching option label, or null if no match found.
 */
function matchAnswerToOption(savedAnswer, options, topic) {
  // Guard: nothing to match if either input is absent
  if (!savedAnswer || !options || options.length === 0) return null;

  const answerLower = savedAnswer.toLowerCase().trim();
  const answerNorm  = normalize(savedAnswer);

  // ── Strategy 0: Pronouns exact match ─────────────────────────────────────
  // Pronoun values like "she/her", "he/him", "they/them" should match by
  // exact case-insensitive comparison before any normalization strips the
  // slashes, which would cause false positives in fuzzy matching.
  if (topic === 'pronouns') {
    for (const opt of options) {
      if (opt.toLowerCase().trim() === answerLower) return opt;
    }
  }

  // ── Strategy 1: Exact match (case-insensitive) ────────────────────────────
  // The cheapest check — covers the common case where the user typed the
  // option text verbatim (e.g., saved "Male", option is "Male").
  for (const opt of options) {
    if (opt.toLowerCase().trim() === answerLower) return opt;
  }

  // ── Strategy 2: Normalized exact match ───────────────────────────────────
  // Handles differences in punctuation or spacing, e.g. "Straight/Heterosexual"
  // vs "Straight Heterosexual".
  for (const opt of options) {
    if (normalize(opt) === answerNorm) return opt;
  }

  // ── Strategy 3: Synonym-based matching ───────────────────────────────────
  // Look up synonyms for the answer, then check if any dropdown option
  // TEXT contains one of those synonyms as a substring.
  // e.g., saved answer "indian" → synonyms include "south asian" →
  //   matches option "South Asian (inclusive of ... India ...)"
  const synonyms = ANSWER_SYNONYMS[answerLower] || [];
  if (synonyms.length > 0) {
    for (const opt of options) {
      const optLower = opt.toLowerCase();
      for (const syn of synonyms) {
        // Both exact-equals and substring checks are performed because some
        // platforms use the synonym as the full option text (exact) while
        // others embed it inside a longer label (substring).
        if (optLower === syn || optLower.includes(syn)) return opt;
      }
    }
  }

  // ── Strategy 4: Containment match ────────────────────────────────────────
  // One string is a substring of the other. Catches cases like:
  //   saved "heterosexual" ↔ option "Heterosexual / Straight"
  for (const opt of options) {
    const optLower = opt.toLowerCase().trim();
    if (optLower.includes(answerLower) || answerLower.includes(optLower)) return opt;
  }

  // ── Strategy 5: Word-level matching for race/ethnicity ───────────────────
  // Race/ethnicity options are often written as long, parenthetical strings
  // such as "South Asian (inclusive of India, Pakistan, Sri Lanka, etc.)".
  // The generic containment check above may not catch all variants, so this
  // dedicated pass re-checks both the raw answer and its synonyms against the
  // full option string, which can include parenthetical country lists.
  // Note: this block intentionally duplicates some logic from strategies 3/4
  // to ensure nothing is missed for this particularly variable topic.
  if (['race_ethnicity', 'disability', 'veteran'].includes(topic)) {
    for (const opt of options) {
      const optLower = opt.toLowerCase();

      // Check if the answer word itself appears anywhere in the option text
      if (optLower.includes(answerLower)) return opt;

      // Also check every synonym against the full option text
      for (const syn of synonyms) {
        if (optLower.includes(syn)) return opt;
      }
    }
  }

  // ── Strategy 6: Yes/No matching for binary compliance questions ───────────
  // Topics like veteran status, disability, work authorization, and sponsorship
  // are answered with a simple yes/no. However the stored answer might be a
  // natural-language phrase ("I am a veteran", "I do not require sponsorship")
  // and the option label might start with "Yes" or contain "I am not", etc.
  // This block normalizes both sides to yes/no semantics.
  if (['veteran', 'disability', 'hispanic_latino', 'work_auth', 'sponsorship'].includes(topic)) {
    // Detect whether the saved answer is semantically "yes" or "no"
    const isYes = /^(yes|true|1|i am|i do|i have)$/i.test(answerLower);
    const isNo  = /^(no|false|0|i am not|i do not|i don't|i have not)$/i.test(answerLower);

    if (isYes || isNo) {
      for (const opt of options) {
        const optLower = opt.toLowerCase();

        // Affirmative option patterns: starts with "Yes", or uses first-person
        // positive phrasing commonly seen on OFCCP-compliant forms.
        if (isYes && (
          optLower.startsWith('yes') ||
          optLower.includes('i am a ') ||
          optLower.includes('i have a ') ||
          optLower.includes('i do')
        )) return opt;

        // Negative option patterns: starts with "No", or uses first-person
        // negative phrasing.
        if (isNo && (
          optLower.startsWith('no') ||
          optLower.includes('i am not') ||
          optLower.includes('not a ') ||
          optLower.includes('i do not') ||
          optLower.includes("i don't")
        )) return opt;
      }
    }
  }

  // All strategies exhausted — no match found
  return null;
}

// ─── Fallback: find a "decline to answer" option ─────────────────────────────

/**
 * Scans the available options for any variant of "prefer not to answer" /
 * "decline to self-identify". These phrases are the standard EEO fallback on
 * most job application platforms.
 *
 * This is used when the user has no saved answer for a demographic question —
 * rather than leaving it blank, we select the privacy-preserving decline option
 * so the form can still be submitted.
 *
 * @param {string[]} options - All available option labels for the current field.
 * @returns {string|null} The decline option label, or null if none found.
 */
function findDeclineOption(options) {
  // Canonical decline phrases across major ATS platforms (Workday, Greenhouse,
  // Lever, iCIMS, etc.). Listed from most-specific to most-generic so that an
  // option containing "decline to self-identify" is preferred over one that
  // merely contains "decline".
  const declinePatterns = [
    'prefer not to say', 'decline to self-identify', 'decline to answer',
    'prefer not to answer', 'choose not to disclose', 'i prefer not',
    'choose not to answer', "i don't wish to answer", 'prefer not to specify',
    'decline to state', 'rather not say',
    'decline', 'not to say', 'not to disclose'
  ];

  for (const opt of options) {
    const optLower = opt.toLowerCase();
    for (const pattern of declinePatterns) {
      if (optLower.includes(pattern)) return opt;
    }
  }

  // No decline option found in this field's option list
  return null;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Deterministically match a dropdown or radio-button question to the best
 * available option, without making any AI/LLM API calls.
 *
 * The function works in five steps:
 *   1. Detect which topic the question belongs to (EEO, work auth, etc.).
 *   2. Look up the user's saved answer for that topic (Q&A list first,
 *      then the profile object as a fallback).
 *   3. If a saved answer exists, try to map it to an available option using
 *      the cascading matching strategies in matchAnswerToOption().
 *   4. If no saved answer exists AND the topic is demographic, fall back to
 *      the "decline to answer" option so the field isn't left blank.
 *   5. If nothing works, return matched:false so the caller can escalate to
 *      the AI pipeline — but still include the detected topic so the AI
 *      prompt can be given better context.
 *
 * @param {string}   questionText - The form question label text.
 * @param {string[]} options      - Available dropdown/radio option labels.
 * @param {Array<{question: string, answer: string}>} qaList - User's saved Q&A pairs.
 * @param {Object}   profile      - User's resume profile object.
 * @returns {{ matched: boolean, option: string|null, topic: string|null }}
 *   matched: true if a deterministic selection was made.
 *   option:  the selected option label (null when matched is false).
 *   topic:   the detected topic key (present even when matched is false, so
 *            callers know this is a recognized EEO-type question).
 */
function deterministicFieldMatcher(questionText, options, qaList, profile) {
  // ── Step 1: Detect which topic this question belongs to ───────────────────
  const topic = detectTopic(questionText);
  if (!topic) {
    return { matched: false, option: null, topic: null };
  }

  // ── Step 1.5: Direct-value topics (text inputs, no option matching) ───────
  // For fields like name, email, phone, URLs — return the value directly.
  // These are text input fields, not dropdowns, so we return the value as-is.
  const DIRECT_VALUE_TOPICS = [
    'first_name', 'last_name', 'full_name', 'email', 'phone',
    'linkedin_url', 'website_url', 'github_url', 'location',
    'current_title', 'current_employer'
  ];
  if (DIRECT_VALUE_TOPICS.includes(topic)) {
    let value = findQAAnswer(topic, qaList);
    if (!value) value = findProfileAnswer(topic, profile);
    if (value) {
      // For direct-value fields with no dropdown options, return the value as the option
      // If options are present (it's actually a dropdown), try to match
      if (options && options.length > 0) {
        const match = matchAnswerToOption(value, options, topic);
        if (match) return { matched: true, option: match, topic };
      } else {
        return { matched: true, option: value, topic };
      }
    }
  }

  // ── Step 2: Find the user's saved answer for this topic ───────────────────
  let savedAnswer = findQAAnswer(topic, qaList);
  if (!savedAnswer) {
    savedAnswer = findProfileAnswer(topic, profile);
  }

  // ── Step 2.5: Simple yes/no topics from Q&A ─────────────────────────────
  // For binary questions like background_check, drug_test, age_18, etc.
  const YES_NO_TOPICS = [
    'background_check', 'drug_test', 'drivers_license', 'age_18',
    'relocation', 'travel'
  ];
  if (YES_NO_TOPICS.includes(topic) && savedAnswer && options && options.length > 0) {
    const match = matchAnswerToOption(savedAnswer, options, topic);
    if (match) return { matched: true, option: match, topic };
    // Try yes/no heuristic
    const answerLower = savedAnswer.toLowerCase().trim();
    const isYes = /^(yes|true|1|i am|i do|i have|i will|willing)$/i.test(answerLower);
    const isNo = /^(no|false|0|i am not|i do not|i don't|i won't|unwilling|not willing)$/i.test(answerLower);
    if (isYes || isNo) {
      for (const opt of options) {
        const optLower = opt.toLowerCase();
        if (isYes && (optLower.startsWith('yes') || optLower === 'true')) return { matched: true, option: opt, topic };
        if (isNo && (optLower.startsWith('no') || optLower === 'false')) return { matched: true, option: opt, topic };
      }
    }
  }

  // ── Step 3: Map the saved answer to an available option ───────────────────
  if (savedAnswer) {
    const match = matchAnswerToOption(savedAnswer, options, topic);
    if (match) {
      return { matched: true, option: match, topic };
    }
  }

  // ── Step 4: Demographic fallback — select "decline to answer" ─────────────
  // If the topic is a standard demographic category AND the user has no saved
  // answer, automatically select the privacy-preserving decline option.
  // This ensures the form can be submitted without leaving required EEO fields
  // blank.
  //
  // IMPORTANT: We only use the decline option when savedAnswer is null/empty.
  // If the user DID save an answer but it failed to match any option (e.g.,
  // due to an unusual option label on this particular ATS), we fall through to
  // the AI pipeline instead of silently overriding their preference with "decline".
  const demographicTopics = [
    'gender', 'gender_identity', 'sexual_orientation', 'race_ethnicity',
    'veteran', 'disability', 'hispanic_latino', 'pronouns'
  ];
  if (demographicTopics.includes(topic)) {
    const decline = findDeclineOption(options);
    if (decline && !savedAnswer) {
      // Use decline only when the user has no saved answer at all
      return { matched: true, option: decline, topic };
    }
  }

  // ── Step 5: Deterministic matching failed ─────────────────────────────────
  // Return matched:false so the caller knows to escalate to the AI pipeline.
  // The topic is still returned so the caller can include it in the AI prompt
  // as useful context (e.g., "this is a work authorization question").
  return { matched: false, option: null, topic };
}

export { deterministicFieldMatcher, detectTopic, normalize };
