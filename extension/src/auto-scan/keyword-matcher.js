// auto-scan/keyword-matcher.js — Local keyword-matching engine for auto-scan widget
// Zero AI calls, zero tokens. Pure text overlap between profile and JD.

// ─── Keyword Aliases ──────────────────────────────────────────────
// Normalizes common tech abbreviations and variations to canonical forms.
const KEYWORD_ALIASES = {
  'js': 'javascript',
  'ts': 'typescript',
  'react.js': 'react',
  'reactjs': 'react',
  'react native': 'react native',
  'vue.js': 'vue',
  'vuejs': 'vue',
  'next.js': 'nextjs',
  'nuxt.js': 'nuxtjs',
  'node.js': 'nodejs',
  'node': 'nodejs',
  'express.js': 'express',
  'expressjs': 'express',
  'c#': 'csharp',
  'c++': 'cplusplus',
  'python3': 'python',
  'py': 'python',
  'golang': 'go',
  'rust lang': 'rust',
  'ml': 'machine learning',
  'ai': 'artificial intelligence',
  'dl': 'deep learning',
  'nlp': 'natural language processing',
  'cv': 'computer vision',
  'llm': 'large language model',
  'llms': 'large language model',
  'gen ai': 'generative ai',
  'genai': 'generative ai',
  'aws': 'amazon web services',
  'gcp': 'google cloud platform',
  'google cloud': 'google cloud platform',
  'azure': 'microsoft azure',
  'k8s': 'kubernetes',
  'k8': 'kubernetes',
  'docker compose': 'docker compose',
  'ci/cd': 'cicd',
  'ci cd': 'cicd',
  'devops': 'devops',
  'sre': 'site reliability engineering',
  'postgres': 'postgresql',
  'pg': 'postgresql',
  'mongo': 'mongodb',
  'dynamodb': 'dynamodb',
  'mysql': 'mysql',
  'mssql': 'sql server',
  'sql server': 'sql server',
  'nosql': 'nosql',
  'graphql': 'graphql',
  'rest api': 'rest api',
  'restful': 'rest api',
  'api': 'api',
  'saas': 'software as a service',
  'b2b': 'business to business',
  'b2c': 'business to consumer',
  'pm': 'product management',
  'product mgmt': 'product management',
  'ux': 'user experience',
  'ui': 'user interface',
  'ui/ux': 'user experience',
  'ux/ui': 'user experience',
  'figma': 'figma',
  'a/b testing': 'ab testing',
  'ab testing': 'ab testing',
  'scrum': 'scrum',
  'kanban': 'kanban',
  'agile': 'agile',
  'jira': 'jira',
  'confluence': 'confluence',
  'okr': 'objectives and key results',
  'okrs': 'objectives and key results',
  'kpi': 'key performance indicator',
  'kpis': 'key performance indicator',
  'roi': 'return on investment',
  'etl': 'extract transform load',
  'elt': 'extract load transform',
  'bi': 'business intelligence',
  'data viz': 'data visualization',
  'tableau': 'tableau',
  'power bi': 'power bi',
  'looker': 'looker',
  'tf': 'tensorflow',
  'tensorflow': 'tensorflow',
  'pytorch': 'pytorch',
  'keras': 'keras',
  'scikit learn': 'scikit learn',
  'sklearn': 'scikit learn',
  'pandas': 'pandas',
  'numpy': 'numpy',
  'scipy': 'scipy',
  'r lang': 'r',
  'rlang': 'r',
  'html5': 'html',
  'css3': 'css',
  'scss': 'sass',
  'less': 'less',
  'tailwind': 'tailwindcss',
  'tailwind css': 'tailwindcss',
  'bootstrap': 'bootstrap',
  'material ui': 'material ui',
  'mui': 'material ui',
  'swift': 'swift',
  'kotlin': 'kotlin',
  'flutter': 'flutter',
  'dart': 'dart',
  'obj-c': 'objective c',
  'objective-c': 'objective c',
  'ios': 'ios',
  'android': 'android',
  'rb': 'ruby',
  'ror': 'ruby on rails',
  'rails': 'ruby on rails',
  'django': 'django',
  'flask': 'flask',
  'fastapi': 'fastapi',
  'spring boot': 'spring boot',
  'spring': 'spring',
  '.net': 'dotnet',
  'dotnet': 'dotnet',
  'asp.net': 'dotnet',
  'php': 'php',
  'laravel': 'laravel',
  'wordpress': 'wordpress',
  'shopify': 'shopify',
  'terraform': 'terraform',
  'ansible': 'ansible',
  'puppet': 'puppet',
  'chef': 'chef',
  'jenkins': 'jenkins',
  'github actions': 'github actions',
  'gitlab ci': 'gitlab ci',
  'circleci': 'circleci',
  'argocd': 'argocd',
  'kafka': 'kafka',
  'rabbitmq': 'rabbitmq',
  'redis': 'redis',
  'elasticsearch': 'elasticsearch',
  'elastic': 'elasticsearch',
  'kibana': 'kibana',
  'grafana': 'grafana',
  'prometheus': 'prometheus',
  'datadog': 'datadog',
  'new relic': 'new relic',
  'splunk': 'splunk',
  'snowflake': 'snowflake',
  'bigquery': 'bigquery',
  'redshift': 'redshift',
  'databricks': 'databricks',
  'airflow': 'airflow',
  'spark': 'apache spark',
  'apache spark': 'apache spark',
  'hadoop': 'hadoop',
  'hive': 'hive',
  'presto': 'presto',
  'dbt': 'dbt',
  'oauth': 'oauth',
  'jwt': 'jwt',
  'sso': 'single sign on',
  'saml': 'saml',
  'rbac': 'role based access control',
  'iam': 'identity and access management',
  'soc2': 'soc 2',
  'soc 2': 'soc 2',
  'gdpr': 'gdpr',
  'hipaa': 'hipaa',
  'pci': 'pci dss',
  'pci dss': 'pci dss',
};

// ─── Stopwords ────────────────────────────────────────────────────
// Common English words + job-posting noise filtered from keyword extraction.
const STOPWORDS = new Set([
  // English common
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'must',
  'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'we',
  'they', 'he', 'she', 'my', 'your', 'our', 'their', 'his', 'her',
  'who', 'what', 'which', 'when', 'where', 'how', 'why', 'if', 'then',
  'than', 'so', 'not', 'no', 'nor', 'too', 'very', 'just', 'also',
  'about', 'up', 'out', 'into', 'over', 'after', 'before', 'between',
  'under', 'above', 'through', 'during', 'each', 'all', 'both', 'any',
  'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own',
  'same', 'well', 'also', 'back', 'even', 'still', 'new', 'get',
  // Job-posting noise
  'experience', 'ability', 'strong', 'required', 'preferred', 'including',
  'team', 'work', 'working', 'looking', 'join', 'role', 'position',
  'candidate', 'ideal', 'responsible', 'responsibilities', 'requirements',
  'qualifications', 'skills', 'years', 'year', 'plus', 'minimum',
  'excellent', 'proven', 'demonstrated', 'knowledge', 'understanding',
  'familiarity', 'proficiency', 'proficient', 'equivalent', 'related',
  'relevant', 'similar', 'environment', 'across', 'within', 'company',
  'organization', 'business', 'ensure', 'support', 'develop', 'create',
  'build', 'lead', 'manage', 'drive', 'help', 'make', 'use', 'using',
  'provide', 'identify', 'implement', 'deliver', 'maintain',
  'collaborate', 'communicate', 'opportunity', 'success', 'successful',
  'effectively', 'efficiently', 'level', 'based', 'etc', 'e.g',
  'i.e', 'like', 'want', 'able', 'one', 'two', 'three',
]);

// ─── Bigram Patterns ──────────────────────────────────────────────
// Compound terms that should be matched as a single keyword.
const BIGRAM_SET = new Set([
  'machine learning', 'deep learning', 'data science', 'data engineering',
  'data analysis', 'data analytics', 'data pipeline', 'data warehouse',
  'project management', 'product management', 'program management',
  'product strategy', 'product roadmap', 'product development',
  'product design', 'product owner', 'product led',
  'user experience', 'user interface', 'user research', 'user story',
  'software engineering', 'software development', 'software architecture',
  'full stack', 'front end', 'back end', 'mobile development',
  'web development', 'cloud computing', 'cloud native', 'cloud infrastructure',
  'distributed systems', 'system design', 'systems architecture',
  'microservices', 'event driven', 'domain driven',
  'cross functional', 'stakeholder management', 'change management',
  'risk management', 'vendor management', 'people management',
  'technical leadership', 'technical writing', 'technical debt',
  'continuous integration', 'continuous delivery', 'continuous deployment',
  'version control', 'code review', 'pair programming',
  'test driven', 'behavior driven', 'unit testing', 'integration testing',
  'load testing', 'performance testing', 'regression testing',
  'supply chain', 'customer success', 'customer experience',
  'go to market', 'market research', 'competitive analysis',
  'financial modeling', 'business analysis', 'business intelligence',
  'natural language', 'computer vision', 'reinforcement learning',
  'transfer learning', 'feature engineering', 'model training',
  'neural network', 'large language', 'generative ai',
  'real time', 'low latency', 'high availability', 'fault tolerant',
  'single sign', 'access control', 'identity management',
  'rest api', 'api design', 'api gateway',
  'design system', 'component library', 'style guide',
  'ab testing', 'feature flag', 'blue green',
  'infrastructure as', 'platform engineering', 'site reliability',
  'incident management', 'on call', 'post mortem',
  'sprint planning', 'sprint review', 'backlog grooming',
  'object oriented', 'functional programming', 'reactive programming',
  'open source', 'third party', 'service mesh',
  'message queue', 'pub sub', 'stream processing',
  'batch processing', 'map reduce', 'data lake',
]);

// ─── Core: Normalize ──────────────────────────────────────────────

function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s+#./-]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ─── Core: Extract Keywords ───────────────────────────────────────
// Returns Map<string, number> of canonical keyword → frequency count.

export function extractKeywords(text) {
  if (!text || typeof text !== 'string') return new Map();

  const normalized = normalize(text);
  const words = normalized.split(' ');
  const keywords = new Map();

  function addKeyword(kw, count) {
    // Apply alias normalization
    const canonical = KEYWORD_ALIASES[kw] || kw;
    if (canonical.length < 2) return;
    if (STOPWORDS.has(canonical)) return;
    keywords.set(canonical, (keywords.get(canonical) || 0) + count);
  }

  // Pass 1: Extract bigrams first (so they take priority)
  const bigramsFound = new Set();
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = words[i] + ' ' + words[i + 1];
    const aliased = KEYWORD_ALIASES[bigram];
    if (aliased) {
      addKeyword(aliased, 1);
      bigramsFound.add(i);
      bigramsFound.add(i + 1);
    } else if (BIGRAM_SET.has(bigram)) {
      addKeyword(bigram, 1);
      bigramsFound.add(i);
      bigramsFound.add(i + 1);
    }
  }

  // Pass 2: Unigrams (skip words already consumed by bigrams)
  for (let i = 0; i < words.length; i++) {
    if (bigramsFound.has(i)) continue;
    const word = words[i];
    if (word.length < 2) continue;
    addKeyword(word, 1);
  }

  return keywords;
}

// ─── Core: Extract Profile Keywords ───────────────────────────────
// Processes the entire user context into a single weighted keyword map.
// Called once on load, cached, re-extracted on profile change.

export function extractProfileKeywords(profile, context) {
  if (!profile) return new Map();

  const weightedTexts = [];

  // Skills — highest weight (explicitly declared competencies)
  const skills = profile.skills;
  if (skills) {
    const skillText = Array.isArray(skills) ? skills.join(', ') : skills;
    weightedTexts.push({ text: skillText, weight: 3 });
  }

  // Experience titles + descriptions — high weight
  if (Array.isArray(profile.experience)) {
    for (const exp of profile.experience) {
      if (exp.title) weightedTexts.push({ text: exp.title, weight: 2 });
      if (exp.description) weightedTexts.push({ text: exp.description, weight: 2 });
    }
  }

  // Summary — high weight
  if (profile.summary) {
    weightedTexts.push({ text: profile.summary, weight: 2 });
  }

  // Education
  if (Array.isArray(profile.education)) {
    for (const edu of profile.education) {
      if (edu.field) weightedTexts.push({ text: edu.field, weight: 1 });
      if (edu.degree) weightedTexts.push({ text: edu.degree, weight: 1 });
      if (edu.school) weightedTexts.push({ text: edu.school, weight: 1 });
    }
  }

  // Certifications
  if (Array.isArray(profile.certifications)) {
    for (const cert of profile.certifications) {
      const certText = typeof cert === 'string' ? cert : cert.name || '';
      if (certText) weightedTexts.push({ text: certText, weight: 1 });
    }
  }

  // Projects
  if (Array.isArray(profile.projects)) {
    for (const proj of profile.projects) {
      if (proj.description) weightedTexts.push({ text: proj.description, weight: 1 });
      if (proj.technologies) weightedTexts.push({ text: proj.technologies, weight: 2 });
    }
  }

  // Applicant context — sections and text dumps
  if (context && context.applicantContext) {
    const ac = context.applicantContext;
    if (ac.sections && typeof ac.sections === 'object') {
      for (const section of Object.values(ac.sections)) {
        if (typeof section === 'string' && section.trim()) {
          weightedTexts.push({ text: section, weight: 1 });
        }
      }
    }
    if (Array.isArray(ac.textDumps)) {
      for (const dump of ac.textDumps) {
        const dumpText = typeof dump === 'string' ? dump : dump.text || '';
        if (dumpText) weightedTexts.push({ text: dumpText, weight: 1 });
      }
    }
  }

  // Legacy Q&A answers
  if (context && Array.isArray(context.qaList)) {
    for (const qa of context.qaList) {
      if (qa.answer) weightedTexts.push({ text: qa.answer, weight: 1 });
    }
  }

  // Build combined keyword map with weights
  const combined = new Map();
  for (const { text, weight } of weightedTexts) {
    const kw = extractKeywords(text);
    for (const [key, count] of kw) {
      combined.set(key, (combined.get(key) || 0) + count * weight);
    }
  }

  return combined;
}

// ─── Core: Compute Match Score ────────────────────────────────────
// Compares profile keywords against JD keywords using inverse frequency weighting.

export function computeMatchScore(profileKeywords, jdKeywords) {
  if (!profileKeywords || !jdKeywords || profileKeywords.size === 0 || jdKeywords.size === 0) {
    return { score: 0, matchedKeywords: [], missingKeywords: [], totalJdKeywords: 0, totalProfileKeywords: 0 };
  }

  // Compute inverse frequency weights for JD keywords
  // Rare keywords in the JD are more important (specific skill requirements)
  const maxFreq = Math.max(...jdKeywords.values());
  const jdEntries = [];
  for (const [kw, freq] of jdKeywords) {
    // IDF-like weight: rare terms get higher weight
    const weight = 1 + Math.log(maxFreq / freq);
    jdEntries.push({ keyword: kw, freq, weight });
  }

  let matchedWeight = 0;
  let totalWeight = 0;
  const matched = [];
  const missing = [];

  for (const entry of jdEntries) {
    totalWeight += entry.weight;
    if (profileKeywords.has(entry.keyword)) {
      matchedWeight += entry.weight;
      matched.push({ keyword: entry.keyword, weight: entry.weight });
    } else {
      missing.push({ keyword: entry.keyword, weight: entry.weight });
    }
  }

  // Sort by weight descending and take top 10
  matched.sort((a, b) => b.weight - a.weight);
  missing.sort((a, b) => b.weight - a.weight);

  const score = totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) : 0;

  return {
    score: Math.min(100, Math.max(0, score)),
    matchedKeywords: matched.slice(0, 10).map(m => m.keyword),
    missingKeywords: missing.slice(0, 10).map(m => m.keyword),
    totalJdKeywords: jdKeywords.size,
    totalProfileKeywords: profileKeywords.size,
  };
}
